import json
import math
from datetime import datetime, timezone, date
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
from fastapi import HTTPException
import scipy.stats as stats
from sqlalchemy.orm import Session

from app.models.product import Product
from app.models.supplier import Supplier
from app.models.forecast import Forecast
from app.models.forecast_backtest import ForecastBacktest
from app.models.sales_history import SalesHistory
from app.models.inventory_param import InventoryParam
from app.models.user import User
from app.models.policy_selection import PolicySelection
from app.models.classification import SKUClassification
from app.models.sim_clock import SimClock
from app.services import policy_config as pc
from app.services import policy_backtest
from app.services.calibrator_service import calibrator_service, selection_store
from app.services.window_quantile_service import (
    WindowQuantileService,
    build_actuals_matrix,
    window_quantile_service,
)
from app.repositories.inventory_param_repository import inventory_param_repository
from app.repositories.system_setting_repository import system_setting_repository
from app.services.audit_service import audit_service
from app.schemas.optimization import (
    ServiceLevelConfig,
    ServiceLevelConfigUpdate,
    InventoryParamItem,
    InventoryParamsListResponse,
    CompareParamItem,
    CompareStaticResponse,
    SensitivityScenario,
    SensitivityAnalysisRequest,
    SensitivityAnalysisResponse,
)


class OptimizationService:
    SETTINGS_KEY = "target_service_level_config"
    # A3 cost assumptions and timing: single source = policy_config (R-28, B-20)
    ORDER_COST_C = pc.ORDER_COST_C
    HOLDING_RATE_DAILY = pc.HOLDING_RATE_DAILY
    STOCKOUT_PENALTY_RATE = pc.STOCKOUT_PENALTY_RATE
    DEFAULT_HOLDING_COST = 2.5
    DEFAULT_ORDER_COST = pc.ORDER_COST_C
    DEFAULT_LEAD_TIME = pc.LEAD_TIME_DAYS
    DEFAULT_REVIEW_PERIOD = pc.REVIEW_PERIOD_DAYS

    # Neutral starting policy (P6 / C3-OUT: m_g = 0 so the closed-loop theta is not applied twice, N-05).
    # val_cost / val_service are NOT invented: they stay empty until J5 measures them.
    DEFAULT_OPTIMAL_POLICIES = {
        c: {"m_g": 0.0, "kappa_g": 1.0, "val_cost": None, "val_service": None} for c in pc.ALL_CLASSES
    }

    # --- UC29: Target Service Level Configuration ---

    def get_service_level_config(self, db: Session) -> ServiceLevelConfig:
        """
        UC29 - Lấy cấu hình Service Level mục tiêu (tau) từ System Settings.
        """
        setting = system_setting_repository.get_by_key(db, self.SETTINGS_KEY)
        if setting and isinstance(setting.value, dict):
            val = setting.value
            return ServiceLevelConfig(
                default_service_level=float(val.get("default_service_level", 0.95)),
                category_service_levels={
                    k: float(v) for k, v in val.get("category_service_levels", {}).items()
                },
                item_service_levels={
                    k: float(v) for k, v in val.get("item_service_levels", {}).items()
                },
            )
        return ServiceLevelConfig()

    def update_service_level_config(
        self,
        db: Session,
        request: ServiceLevelConfigUpdate,
        current_user: User,
        ip_address: Optional[str] = None,
    ) -> ServiceLevelConfig:
        """
        UC29 - Cập nhật mức phục vụ mục tiêu (Admin only).
        Tự động tính lại tham số tồn kho SS/ROP cho các SKU liên quan và ghi audit log.
        """
        current_cfg = self.get_service_level_config(db)
        old_val_str = json.dumps(current_cfg.model_dump(), ensure_ascii=False)

        new_default = (
            request.default_service_level
            if request.default_service_level is not None
            else current_cfg.default_service_level
        )
        new_cat = (
            request.category_service_levels
            if request.category_service_levels is not None
            else current_cfg.category_service_levels
        )
        new_items = (
            request.item_service_levels
            if request.item_service_levels is not None
            else current_cfg.item_service_levels
        )

        new_data = {
            "default_service_level": new_default,
            "category_service_levels": new_cat,
            "item_service_levels": new_items,
        }
        new_val_str = json.dumps(new_data, ensure_ascii=False)

        system_setting_repository.upsert_setting(
            db,
            key=self.SETTINGS_KEY,
            value=new_data,
            description="Cấu hình mức phục vụ mục tiêu (Target Service Level tau)",
        )

        audit_service.log(
            db,
            action="optimization.update_service_level",
            actor_email=current_user.email,
            ip_address=ip_address,
            details=f"Cập nhật Service Level: cũ={old_val_str} -> mới={new_val_str}",
        )
        db.commit()

        # Tự động tính lại tham số tồn kho SS / ROP
        self.recompute_parameters(db)

        return ServiceLevelConfig(**new_data)

    def _resolve_service_level(
        self, config: ServiceLevelConfig, item_id: str, category: Optional[str]
    ) -> float:
        if item_id in config.item_service_levels:
            return config.item_service_levels[item_id]
        if category and category in config.category_service_levels:
            return config.category_service_levels[category]
        return config.default_service_level

    # ------------------------------------------------------------------------------------
    # lead time (R-28 / B-20): ONE source, policy_config (L = 3, R = 7, H = 10)
    # ------------------------------------------------------------------------------------
    def _use_supplier_lead_time(self, db: Session) -> bool:
        s = system_setting_repository.get_by_key(db, "use_supplier_lead_time")
        if not s:
            return False
        v = s.value
        if isinstance(v, dict):
            v = v.get("enabled", v.get("value", False))
        return str(v).strip().lower() in ("1", "true", "yes", "on")

    @staticmethod
    def _supplier_lt_map(db: Session) -> Dict[str, int]:
        keywords = {"FOODS": ("thực phẩm", "food"), "HOBBIES": ("sở thích", "hobbi"), "HOUSEHOLD": ("gia dụng", "household")}
        out: Dict[str, int] = {}
        for supp in db.query(Supplier).all():
            if not supp.lead_time_days:
                continue
            name = (supp.name or "").lower()
            for cat, kws in keywords.items():
                if any(k in name for k in kws) and cat not in out:
                    out[cat] = max(1, int(supp.lead_time_days))
        return out

    def _resolve_lead_time(self, db: Session, item_id: str) -> int:
        """L = 3 for every SKU (research.md §3) unless the operator opted in to supplier lead times
        through the system setting ``use_supplier_lead_time``."""
        if self._use_supplier_lead_time(db):
            prod = db.query(Product).filter(Product.item_id == item_id).first()
            if prod and prod.cat_id:
                lt = self._supplier_lt_map(db).get(prod.cat_id.upper())
                if lt:
                    return lt
        return self.DEFAULT_LEAD_TIME

    # ------------------------------------------------------------------------------------
    # UC30: parameters. ONE code path for per-SKU and bulk (P-02: bulk == per-SKU by construction)
    # ------------------------------------------------------------------------------------
    @staticmethod
    def _store_origin(db: Session, store_id: str) -> date:
        """The origin of every quantile / theta lookup is the simulated clock date of the store (R-07)."""
        clock = db.query(SimClock).filter(SimClock.store_id == store_id).first()
        if clock and clock.current_date:
            return clock.current_date
        # U-17: ONE demo origin (never min(forecast_date)): the forecast table starts one month later and a
        # second origin would create a second set of window-quantile rows.
        return pc.DEMO_START_DATE

    def _demand_stats(
        self, db: Session, store_id: str, item_ids: List[str], origin_date: date, days: int
    ) -> Dict[str, Tuple[float, float]]:
        """(mean, std) of daily demand over the ``days`` days BEFORE the origin (causal). Missing days
        are skipped, never treated as 0."""
        o_idx = pc.date_to_day_index(origin_date)
        A = build_actuals_matrix(db, store_id, item_ids, max(0, o_idx - days), o_idx)
        out: Dict[str, Tuple[float, float]] = {}
        if A.shape[1] == 0:
            return out
        with np.errstate(all="ignore"):
            mean = np.nanmean(A, axis=1)
            std = np.nanstd(A, axis=1)
        for iid, m, s in zip(item_ids, mean, std):
            if not np.isnan(m):
                out[iid] = (float(m), float(s))
        return out

    def _forecast_backed_items(self, db: Session, store_id: str, item_ids: List[str]) -> set:
        """Items with a real Tier-1 Ensemble forecast or a causal backtest forecast (P-24)."""
        found = set()
        for k in range(0, len(item_ids), 900):
            chunk = item_ids[k:k + 900]
            found.update(
                r[0] for r in db.query(Forecast.item_id)
                .filter(Forecast.store_id == store_id, Forecast.item_id.in_(chunk),
                        Forecast.model_version.ilike(pc.POINT_FORECAST_MODEL_PATTERN))
                .distinct().all()
            )
            found.update(
                r[0] for r in db.query(ForecastBacktest.item_id)
                .filter(ForecastBacktest.store_id == store_id, ForecastBacktest.item_id.in_(chunk))
                .distinct().all()
            )
        return found

    def _compute_params_batch(
        self,
        db: Session,
        products: List[Product],
        store_id: str,
        config: ServiceLevelConfig,
        force_static: bool = False,
        tau_override: Optional[float] = None,
        persist_quantiles: bool = True,
    ) -> List[Dict[str, Any]]:
        """REFIT-RSS-EOQ-G (ML) parameters, falling back per SKU to the static formula."""
        origin_date = self._store_origin(db, store_id)
        item_ids = [p.item_id for p in products]
        use_supplier = self._use_supplier_lead_time(db)
        supp_map = self._supplier_lt_map(db) if use_supplier else {}
        lt_of = {
            p.item_id: supp_map.get((p.cat_id or "").upper(), self.DEFAULT_LEAD_TIME) if use_supplier
            else self.DEFAULT_LEAD_TIME
            for p in products
        }
        tau_of = {
            p.item_id: (tau_override if tau_override is not None
                        else self._resolve_service_level(config, p.item_id, p.cat_id))
            for p in products
        }

        ml_ids: List[str] = [] if force_static else sorted(self._forecast_backed_items(db, store_id, item_ids))
        ml_set = set(ml_ids)

        results: List[Dict[str, Any]] = []
        if ml_ids:
            segs = {
                r[0]: r[1] for r in db.query(SKUClassification.item_id, SKUClassification.segment)
                .filter(SKUClassification.store_id == store_id).all()
            }
            policies = calibrator_service.resolve_policies(db, store_id)
            thetas = calibrator_service.get_current_thetas(db, store_id, as_of=origin_date)
            # one quantile record per (item, origin = clock date, H); computed in ONE vectorised pass
            recs: Dict[str, Any] = {}
            by_h: Dict[int, List[str]] = {}
            for iid in ml_ids:
                by_h.setdefault(lt_of[iid] + self.DEFAULT_REVIEW_PERIOD, []).append(iid)
            for H, ids in by_h.items():
                recs.update(window_quantile_service.get_or_create_window_quantiles_bulk(
                    db, store_id, ids, origin_date, H, persist=persist_quantiles))
            stats_map = self._demand_stats(db, store_id, ml_ids, origin_date, 56)
            price_of = {p.item_id: p for p in products}
            for iid in ml_ids:
                prod = price_of[iid]
                lt = lt_of[iid]
                H = lt + self.DEFAULT_REVIEW_PERIOD
                rec = recs.get(iid)
                if rec is None:
                    ml_set.discard(iid)
                    continue
                q_hat = WindowQuantileService.tau_value(rec.q_levels or {}, tau_of[iid], rec.point_window)
                segment = segs.get(iid, "AX")
                pol = policies.get(segment)
                m_g = float(pol.m_g) if pol and pol.m_g is not None else 0.0
                kappa = float(pol.kappa_g) if pol and pol.kappa_g is not None else 1.0
                theta = float(thetas.get(segment, 0.0))
                s_val = float(math.ceil(q_hat * math.exp(m_g + theta)))
                mean_d, std_d = stats_map.get(iid, (None, None))
                if mean_d is None or mean_d <= 0:
                    mean_d = max(0.1, float(rec.point_window) / max(1, H))  # forecast-implied rate, not a constant
                    std_d = std_d if std_d is not None else 0.0
                results.append(self._finish_params(
                    prod, store_id, lt, tau_of[iid], s_val, kappa, mean_d, std_d or 0.0,
                    source="ml", model_run_id="REFIT-RSS-EOQ-G",
                    extra={"segment": segment, "m_g": m_g, "kappa_g": kappa, "theta_g": theta, "q_hat": q_hat},
                ))
        static_ids = [p for p in products if p.item_id not in ml_set]
        if static_ids:
            stats_map = self._demand_stats(db, store_id, [p.item_id for p in static_ids], origin_date, 90)
            for p in static_ids:
                results.append(self._static_from_stats(
                    p, store_id, lt_of[p.item_id], tau_of[p.item_id], stats_map.get(p.item_id)))
        return results

    def _finish_params(
        self, prod: Product, store_id: str, lt: int, tau: float, s_val: float, kappa: float,
        mean_demand: float, std_demand: float, source: str, model_run_id: str,
        extra: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """EOQ, S = s + ceil(kappa * EOQ), SS, costs (A3) from s. Shared by ML and static paths."""
        unit_price = float(prod.price) if prod.price and float(prod.price) > 0 else 10.0
        h_cost = max(0.2, round(self.HOLDING_RATE_DAILY * 365.0 * unit_price, 3))
        annual_demand = max(1.0, round(mean_demand * 365.0, 2))
        eoq = max(1.0, round(math.sqrt((2.0 * annual_demand * self.ORDER_COST_C) / h_cost), 1))
        S_val = float(s_val + math.ceil(kappa * eoq))
        d_l = round(mean_demand * lt, 2)
        out = {
            "item_id": prod.item_id,
            "safety_stock": max(0.0, round(s_val - d_l, 2)),
            "reorder_point": s_val, "eoq": eoq, "s": s_val, "S": S_val,
            "model_run_id": model_run_id, "annual_demand": annual_demand,
            "holding_cost": h_cost, "order_cost": self.ORDER_COST_C, "unit_price": unit_price,
            "source": source, "d_l": d_l, "lead_time_days": lt, "service_level": tau,
            "sigma_d": round(max(0.2, std_demand), 2),
            "sigma_l": round(max(0.2, std_demand) * math.sqrt(lt), 2),
        }
        if extra:
            out.update(extra)
        return out

    def _static_from_stats(
        self, prod: Product, store_id: str, lt: int, tau: float, stats_pair: Optional[Tuple[float, float]]
    ) -> Dict[str, Any]:
        avg_daily, sigma_d = stats_pair if stats_pair else (0.0, 0.0)
        avg_daily = max(0.1, avg_daily)  # numerical floor only, no invented demand level
        sigma_d = max(0.2, sigma_d)
        tau_safe = min(max(float(tau), 0.50), 0.999)
        z_tau = float(stats.norm.ppf(tau_safe))
        sigma_l = sigma_d * math.sqrt(lt)
        safety_stock = max(0.0, round(z_tau * sigma_l, 2))
        reorder_point = max(0.0, round(avg_daily * lt + safety_stock, 2))
        res = self._finish_params(
            prod, store_id, lt, tau, float(math.ceil(reorder_point)), 1.0, avg_daily, sigma_d,
            source="static", model_run_id="static-moving-avg",
        )
        res.update({"safety_stock": safety_stock, "reorder_point": reorder_point, "d_l": avg_daily * lt,
                    "sigma_l": sigma_l, "sigma_d": sigma_d})
        return res

    def _calculate_ml_params(
        self, db: Session, item_id: str, store_id: str, lead_time_days: int, tau: float
    ) -> Optional[Dict[str, Any]]:
        """Per-SKU REFIT-RSS-EOQ-G parameters (None when the SKU has no Tier-1 forecast). Same code path
        as the bulk recompute."""
        prod = db.query(Product).filter(Product.item_id == item_id).first()
        if prod is None:
            return None
        res = self._compute_params_batch(db, [prod], store_id, self.get_service_level_config(db), tau_override=tau, persist_quantiles=False)
        return res[0] if res and res[0]["source"] == "ml" else None

    def _calculate_static_params(
        self, db: Session, item_id: str, store_id: str, lead_time_days: int, tau: float
    ) -> Dict[str, Any]:
        """Traditional moving-average (R,s,S) formula, used as fallback and as the UC31 baseline."""
        prod = db.query(Product).filter(Product.item_id == item_id).first() or Product(item_id=item_id, price=10.0)
        origin = self._store_origin(db, store_id)
        stats_pair = self._demand_stats(db, store_id, [item_id], origin, 90).get(item_id)
        if stats_pair is None:  # sales newer than the clock (e.g. no clock yet): use the latest rows
            q = (db.query(SalesHistory.quantity)
                 .filter(SalesHistory.item_id == item_id, SalesHistory.store_id == store_id)
                 .order_by(SalesHistory.sale_date.desc()).limit(90).all())
            if q:
                arr = np.array([float(r[0] or 0.0) for r in q])
                stats_pair = (float(arr.mean()), float(arr.std()) if len(arr) > 1 else 0.0)
        return self._static_from_stats(prod, store_id, lead_time_days, tau, stats_pair)

    def recompute_parameters(
        self,
        db: Session,
        store_id: str = "CA_1",
        item_id: Optional[str] = None,
        force_static: bool = False,
        item_ids: Optional[List[str]] = None,
    ) -> int:
        """
        UC30 - compute and store s, S, SS, ROP, EOQ in ``inventory_params``.
        Per-SKU and whole-store use the same computation (``_compute_params_batch``); the whole-store
        call writes all rows in one transaction (R-18, P-02).
        """
        config = self.get_service_level_config(db)
        query = db.query(Product)
        if item_id:
            query = query.filter(Product.item_id == item_id)
        elif item_ids is not None:  # P-27: a SET of SKUs is recomputed once, in bulk
            query = query.filter(Product.item_id.in_(list(item_ids)))
        products = query.all()
        if not products:
            return 0
        results = self._compute_params_batch(db, products, store_id, config, force_static)
        now = datetime.now(timezone.utc)
        cols = ("item_id", "safety_stock", "reorder_point", "eoq", "s", "S", "model_run_id", "annual_demand",
                "holding_cost", "order_cost", "unit_price", "source", "lead_time_days", "service_level")
        if item_id is None and (item_ids is not None or len(results) > 10):
            rows = [{**{c: r[c] for c in cols}, "id": f"{store_id}_{r['item_id']}", "store_id": store_id,
                     "updated_at": now} for r in results]
            old = db.query(InventoryParam).filter(InventoryParam.store_id == store_id)
            if item_ids is not None:
                old = old.filter(InventoryParam.item_id.in_([r["item_id"] for r in rows]))
            old.delete(synchronize_session=False)
            db.bulk_insert_mappings(InventoryParam, rows)
            db.commit()
            return len(rows)
        for r in results:
            inventory_param_repository.upsert(db, InventoryParam(
                id=f"{store_id}_{r['item_id']}", store_id=store_id, updated_at=now, **{c: r[c] for c in cols}))
        return len(results)

    def _bulk_recompute_parameters(
        self, db: Session, products: List[Product], store_id: str, config: ServiceLevelConfig,
        force_static: bool = False,
    ) -> int:
        """Kept for backward compatibility: same computation as the per-SKU path."""
        return self.recompute_parameters(db, store_id=store_id, item_id=None, force_static=force_static)

    def get_parameters(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 50,
        store_id: Optional[str] = None,
        item_id: Optional[str] = None,
        category: Optional[str] = None,
        source: Optional[str] = None,
    ) -> InventoryParamsListResponse:
        """UC30 - list the computed inventory parameters."""
        existing_count = db.query(InventoryParam).count()
        if existing_count == 0:
            self.recompute_parameters(db)

        items, total = inventory_param_repository.get_multi(
            db, skip=skip, limit=limit, store_id=store_id, item_id=item_id, category=category, source=source,
        )
        ids = [it.item_id for it in items]
        product_map = {p.item_id: p for p in db.query(Product).filter(Product.item_id.in_(ids)).all()} if ids else {}

        response_items: List[InventoryParamItem] = []
        for it in items:
            prod = product_map.get(it.item_id)
            response_items.append(
                InventoryParamItem(
                    item_id=it.item_id, store_id=it.store_id,
                    product_name=prod.name if prod else None, category=prod.cat_id if prod else None,
                    service_level=it.service_level, lead_time_days=it.lead_time_days,
                    safety_stock=it.safety_stock, reorder_point=it.reorder_point, eoq=it.eoq,
                    s=it.s, S=it.S, model_run_id=it.model_run_id, annual_demand=it.annual_demand,
                    holding_cost=it.holding_cost, order_cost=it.order_cost, unit_price=it.unit_price,
                    source=it.source, updated_at=it.updated_at,
                )
            )
        return InventoryParamsListResponse(items=response_items, total=total, skip=skip, limit=limit)

    # --- UC31: Compare ML vs Static Formula ---

    @staticmethod
    def _expected_annual_costs(
        s: float, order_qty: float, mu: float, sigma_d: float, price: float, horizon: int,
    ) -> Tuple[float, float, float]:
        """
        Model-based estimate (A3) of the annual (holding, shortage, ordering) cost of an (R,s,S)-type policy
        with reorder point s and order size ``order_qty`` (normal demand over the protection window H):
          holding  = (E[on hand] ) * h,      E[on hand] ~ max(0, s - mu*H) + order_qty / 2
          shortage = b * (365 / R) * sigma_H * G(z),  z = (s - mu*H) / sigma_H   (normal loss function)
          ordering = c * D / order_qty
        This is an analytic estimate, NOT a simulation (the simulator gives the measured numbers).
        """
        h_annual = pc.HOLDING_RATE_DAILY * 365.0 * price
        b = pc.STOCKOUT_PENALTY_RATE * price
        sigma_h = max(1e-6, sigma_d * math.sqrt(horizon))
        z = (s - mu * horizon) / sigma_h
        loss = float(stats.norm.pdf(z) - z * (1.0 - stats.norm.cdf(z)))
        holding = (max(0.0, s - mu * horizon) + order_qty / 2.0) * h_annual
        shortage = b * (365.0 / pc.REVIEW_PERIOD_DAYS) * sigma_h * loss
        ordering = pc.ORDER_COST_C * (mu * 365.0) / max(1.0, order_qty)
        return holding, shortage, ordering

    def compare_ml_vs_static(self, db: Session, store_id: str = "CA_1") -> CompareStaticResponse:
        """
        UC31 - ML (REFIT-RSS-EOQ-G) vs static moving-average parameters. The comparison now charges
        HOLDING + SHORTAGE + ORDERING (R-13); the holding-only fields are kept for compatibility.
        """
        params = db.query(InventoryParam).filter(InventoryParam.store_id == store_id).all()
        if not params:  # R-17: pure GET, never writes
            config = self.get_service_level_config(db)
            prods = db.query(Product).all()
            params = [
                InventoryParam(
                    id=f"{store_id}_{r['item_id']}", store_id=store_id,
                    **{c: r[c] for c in ("item_id", "safety_stock", "reorder_point", "eoq", "s", "S",
                                         "annual_demand", "holding_cost", "order_cost", "unit_price",
                                         "source", "lead_time_days", "service_level")},
                )
                for r in self._compute_params_batch(db, prods, store_id, config, persist_quantiles=False)
            ]
        prod_map = {p.item_id: p for p in db.query(Product).all()}
        origin = self._store_origin(db, store_id)
        ids = [p.item_id for p in params]
        dstats = self._demand_stats(db, store_id, ids, origin, 90) if ids else {}

        items: List[CompareParamItem] = []
        total_savings = 0.0
        total_cost_savings = 0.0
        ss_reduction_percents: List[float] = []

        for p in params:
            prod = prod_map.get(p.item_id)
            prod_name = prod.name if prod else p.item_id
            cat_id = prod.cat_id if prod else "FOODS"
            ml_ss = float(p.safety_stock or 0.0)
            ml_rop = float(p.reorder_point or 0.0)
            ml_eoq = float(p.eoq or 1.0)
            price = float(prod.price) if prod and prod.price and prod.price > 0 else float(p.unit_price or 10.0)
            h_cost = float(p.holding_cost or round(self.HOLDING_RATE_DAILY * 365.0 * price, 3))
            o_cost = float(p.order_cost or self.ORDER_COST_C)
            lt_days = int(p.lead_time_days or self.DEFAULT_LEAD_TIME)
            tau = float(p.service_level or 0.95)
            tau_safe = min(max(tau, 0.50), 0.999)
            avg_daily, sigma_d = dstats.get(p.item_id, (max(0.1, float(p.annual_demand or 36.5) / 365.0), 0.0))
            sigma_d = max(0.2, sigma_d)
            z_score = float(stats.norm.ppf(tau_safe))
            static_ss = round(z_score * sigma_d * math.sqrt(lt_days), 2)
            static_rop = round(avg_daily * lt_days + static_ss, 2)
            static_eoq = max(1.0, round(math.sqrt((2 * avg_daily * 365.0 * o_cost) / h_cost), 2))

            ml_holding = round((ml_ss + ml_eoq / 2.0) * h_cost, 2)
            static_holding = round((static_ss + static_eoq / 2.0) * h_cost, 2)
            savings = round(max(0.0, static_holding - ml_holding), 2)
            total_savings += savings

            H = lt_days + pc.REVIEW_PERIOD_DAYS
            ml_s = float(p.s if p.s is not None else ml_rop)
            ml_S = float(p.S if p.S is not None else ml_s + ml_eoq)
            ml_h, ml_b, ml_o = self._expected_annual_costs(ml_s, max(1.0, ml_S - ml_s), avg_daily, sigma_d, price, H)
            st_h, st_b, st_o = self._expected_annual_costs(static_rop, static_eoq, avg_daily, sigma_d, price, H)
            ml_total = round(ml_h + ml_b + ml_o, 2)
            st_total = round(st_h + st_b + st_o, 2)
            total_cost_savings += st_total - ml_total

            if static_ss > 0:
                ss_reduction_percents.append(max(0.0, (static_ss - ml_ss) / static_ss * 100.0))

            items.append(CompareParamItem(
                item_id=p.item_id, product_name=prod_name, store_id=store_id, category=cat_id,
                lead_time_days=lt_days, service_level=tau,
                ml_safety_stock=ml_ss, ml_reorder_point=ml_rop, ml_eoq=ml_eoq,
                ml_annual_holding_cost=ml_holding,
                static_safety_stock=static_ss, static_reorder_point=static_rop, static_eoq=static_eoq,
                static_annual_holding_cost=static_holding,
                ss_difference=round(static_ss - ml_ss, 2), rop_difference=round(static_rop - ml_rop, 2),
                eoq_difference=round(static_eoq - ml_eoq, 2), holding_cost_savings=savings,
                ml_annual_shortage_cost=round(ml_b, 2), ml_annual_ordering_cost=round(ml_o, 2),
                ml_annual_total_cost=ml_total,
                static_annual_shortage_cost=round(st_b, 2), static_annual_ordering_cost=round(st_o, 2),
                static_annual_total_cost=st_total,
                total_cost_savings=round(st_total - ml_total, 2),
            ))

        return CompareStaticResponse(
            items=items, total_items=len(items),
            total_holding_cost_savings=round(total_savings, 2),
            avg_ss_reduction_percent=round(float(np.mean(ss_reduction_percents)), 2) if ss_reduction_percents else 0.0,
            total_cost_savings=round(total_cost_savings, 2),
            cost_model="analytic estimate: holding + shortage (normal loss) + ordering, A3 rates",
        )

    # --- UC32: Cost Sensitivity Analysis ---

    def run_sensitivity_analysis(
        self, db: Session, request: SensitivityAnalysisRequest
    ) -> SensitivityAnalysisResponse:
        """
        UC32 - Mô phỏng phân tích độ nhạy chi phí khi Lead Time và Service Level thay đổi.
        Tuyệt đối chỉ tính toán mô phỏng trong bộ nhớ, KHÔNG ghi đè dữ liệu thật trong DB.
        """
        store_id = request.store_id or "CA_1"
        config = self.get_service_level_config(db)

        # Lấy SKU mục tiêu hoặc SKU đầu tiên trong hệ thống
        if request.item_id:
            product = (
                db.query(Product).filter(Product.item_id == request.item_id).first()
            )
        else:
            product = db.query(Product).first()

        if not product:
            item_id = "FOODS_1_001"
            base_tau = 0.95
            base_lt = 7
        else:
            item_id = product.item_id
            base_tau = self._resolve_service_level(config, product.item_id, product.cat_id)
            base_lt = self._resolve_lead_time(db, product.item_id)

        # Lấy tham số cơ sở
        params = self._calculate_ml_params(db, item_id, store_id, base_lt, base_tau)
        if not params:
            params = self._calculate_static_params(
                db, item_id, store_id, base_lt, base_tau
            )

        d_daily = params["d_l"] / base_lt
        sigma_d = params["sigma_d"]
        annual_demand = params["annual_demand"]
        h_unit = request.holding_cost_rate * params["unit_price"]
        s_order = request.order_cost
        c_stockout = request.stockout_cost_per_unit

        def _calc_scenario(lt_days: int, tau: float) -> Tuple[float, float, float, float, float, float, float]:
            tau_safe = min(max(float(tau), 0.50), 0.999)
            z = float(stats.norm.ppf(tau_safe))
            sig_l = sigma_d * math.sqrt(lt_days)
            ss = max(0.0, round(z * sig_l, 2))
            rop = max(0.0, round((d_daily * lt_days) + ss, 2))
            eoq = max(1.0, round(math.sqrt((2 * annual_demand * s_order) / h_unit), 2))

            h_cost = round((ss + eoq / 2.0) * h_unit, 2)
            o_cost = round((annual_demand / eoq) * s_order, 2)
            so_cost = round((1.0 - tau) * annual_demand * c_stockout, 2)
            tot = round(h_cost + o_cost + so_cost, 2)
            return ss, rop, eoq, h_cost, o_cost, so_cost, tot

        # Baseline
        b_ss, b_rop, b_eoq, b_h, b_o, b_so, b_tot = _calc_scenario(base_lt, base_tau)
        baseline = SensitivityScenario(
            scenario_id="baseline",
            lead_time_delta_percent=0.0,
            lead_time_days=base_lt,
            service_level_delta_percent=0.0,
            service_level=round(base_tau, 4),
            safety_stock=b_ss,
            reorder_point=b_rop,
            eoq=b_eoq,
            holding_cost=b_h,
            ordering_cost=b_o,
            stockout_cost=b_so,
            total_cost=b_tot,
            cost_difference_vs_baseline=0.0,
        )

        scenarios: List[SensitivityScenario] = []
        scenario_idx = 1

        for lt_delta in request.lead_time_deltas:
            for sl_delta in request.service_level_deltas:
                # Bỏ qua kịch bản 0,0 vì là baseline
                if lt_delta == 0.0 and sl_delta == 0.0:
                    continue

                sim_lt = max(1, int(round(base_lt * (1.0 + lt_delta))))
                sim_tau = min(0.999, max(0.80, round(base_tau + sl_delta, 4)))

                s_ss, s_rop, s_eoq, s_h, s_o, s_so, s_tot = _calc_scenario(
                    sim_lt, sim_tau
                )
                cost_diff = round(s_tot - b_tot, 2)

                scenarios.append(
                    SensitivityScenario(
                        scenario_id=f"scn_{scenario_idx}",
                        lead_time_delta_percent=round(lt_delta * 100.0, 1),
                        lead_time_days=sim_lt,
                        service_level_delta_percent=round(sl_delta * 100.0, 1),
                        service_level=round(sim_tau, 4),
                        safety_stock=s_ss,
                        reorder_point=s_rop,
                        eoq=s_eoq,
                        holding_cost=s_h,
                        ordering_cost=s_o,
                        stockout_cost=s_so,
                        total_cost=s_tot,
                        cost_difference_vs_baseline=cost_diff,
                    )
                )
                scenario_idx += 1

        insights = [
            f"Khi Lead Time tăng 20%, Safety Stock tăng tương ứng khoảng {(math.sqrt(1.2)-1)*100:.1f}%, kéo theo chi phí lưu kho tăng.",
            "Tăng Service Level từ 95% lên 99% giúp giảm mạnh rủi ro thiếu hàng nhưng làm tăng chi phí lưu trữ tồn kho an toàn theo hàm phi tuyến.",
            f"Kịch bản tối ưu chi phí tổng hợp đạt được tại điểm cân bằng giữa chi phí giữ hàng và chi phí rủi ro hết hàng ({c_stockout}$/đơn vị thiếu).",
        ]

        return SensitivityAnalysisResponse(
            item_id=item_id,
            store_id=store_id,
            baseline_scenario=baseline,
            scenarios=scenarios,
            insights=insights,
        )

    # --- Job J5: Quarterly Policy Selection (Task OPT.2) ---

    def _c3out_active(self, db: Session) -> bool:
        """P6 (C3-OUT) is the deployed controller unless the setting ``c3out_active`` says otherwise."""
        s = system_setting_repository.get_by_key(db, "c3out_active")
        if not s:
            return True
        v = s.value
        if isinstance(v, dict):
            v = v.get("enabled", v.get("value", True))
        return str(v).strip().lower() not in ("0", "false", "no", "off")

    def _validation_reviews(
        self, db: Session, store_id: str, item_ids: List[str], o_idx: int, n_periods: int
    ) -> List[int]:
        """Last ``n_periods`` consecutive (spacing R) backtest reviews whose period [s, s+R) is fully observed
        before the origin."""
        days = sorted({
            r[0] for r in db.query(ForecastBacktest.review_day)
            .filter(ForecastBacktest.store_id == store_id, ForecastBacktest.item_id.in_(item_ids[:900]))
            .distinct().all()
        })
        eligible = [d for d in days if d + pc.REVIEW_PERIOD_DAYS <= o_idx]
        if not eligible:
            return []
        chain = [eligible[-1]]
        have = set(eligible)
        while len(chain) < n_periods and chain[-1] - pc.REVIEW_PERIOD_DAYS in have:
            chain.append(chain[-1] - pc.REVIEW_PERIOD_DAYS)
        return sorted(chain)

    def evaluate_class_candidates(
        self, db: Session, store_id: str, class_id: str, o_idx: int, n_periods: int, tau_q: float,
        m_values: List[float], kappa_values: List[float], theta: float = 0.0,
    ) -> Optional[Tuple[policy_backtest.BacktestResult, int, List[int]]]:
        """Score every (m, kappa) of one class with the numpy (R,s,S) backtest over validation reviews."""
        item_ids = [r[0] for r in db.query(SKUClassification.item_id)
                    .filter(SKUClassification.store_id == store_id, SKUClassification.segment == class_id).all()]
        if not item_ids:
            return None
        reviews = self._validation_reviews(db, store_id, item_ids, o_idx, n_periods)
        if len(reviews) < 2:
            return None
        R, H = pc.REVIEW_PERIOD_DAYS, pc.HORIZON_DAYS
        cm = window_quantile_service.causal_quantile_matrix(db, store_id, item_ids, reviews, tau_q, H)
        A = build_actuals_matrix(db, store_id, item_ids, reviews[0], reviews[-1] + R)
        prices = {p.item_id: p.price for p in db.query(Product).filter(Product.item_id.in_(item_ids)).all()}
        price = np.array([float(prices.get(i) or 10.0) for i in item_ids])
        # keep items with complete actuals on the validation days and a quantile for every review
        days_idx = np.concatenate([np.arange(s - reviews[0], s - reviews[0] + R) for s in reviews])
        dem = A[:, days_idx]
        ok = ~np.isnan(dem).any(axis=1) & ~np.isnan(cm["q"]).any(axis=1)
        if ok.sum() == 0:
            return None
        dem, q, point, price = dem[ok], cm["q"][ok], cm["point"][ok], price[ok]
        eoq = np.stack([policy_backtest.eoq_units(point[:, k] / H, price) for k in range(len(reviews))], axis=1)
        res = policy_backtest.simulate_rss_candidates(dem, q, eoq, price, m_values, kappa_values, theta=theta)
        return res, int(ok.sum()), reviews

    @staticmethod
    def tag_selection_id(selection_id: str, store_id: str) -> str:
        """Q-05: a J5 selection always carries its store (CA_1_quarter_2016_Q2) so refitting one store never
        changes the policy of another (resolve_policies ignores selections of other stores)."""
        return selection_id if selection_store(selection_id) else f"{store_id}_{selection_id}"

    def refit_quarterly_policies(
        self,
        db: Session,
        store_id: str = "CA_1",
        selection_id: Optional[str] = None,
        target_availability: Optional[float] = None,
        c3out_active: Optional[bool] = None,
        search_mode: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Job J5 - re-select (m_g, kappa_g) per ABC-XYZ class with a REAL vectorised (R,s,S) backtest over the
        last validation reviews (research.md 7.4; R-10, N-07, R-11):
          * the full grid m in [-0.7, 2.0] x kappa in {0.5, 1, 1.5, 2} is simulated once (daily lost-sales
            dynamics, A3 costs h/b/c, observed availability) at the quantile level tau = target (Q-06);
          * choose the cheapest candidate with availability >= target + guard (guard applied ONCE, here);
            if none is feasible, return the most available one with is_feasible = False;
          * BOTH selections are reported per class (Q-08): kappa_only_* (m_g = 0, the C3-OUT mode: the
            closed-loop theta carries the level so e^(m_g + theta) is never applied twice, N-05) and
            m_grid_* (full 7.4 search). search_mode picks which one is PERSISTED:
            kappa_only | m_grid | auto (default: kappa_only while C3-OUT is active, else m_grid);
          * the controller setpoint is A_g + guard (research.md 8.2), refreshed on every refit (Q-06);
          * selection ids are store-scoped (Q-05).
        """
        if target_availability is None:
            target_availability = float(self.get_service_level_config(db).default_service_level)
        if c3out_active is None:
            c3out_active = self._c3out_active(db)
        mode = (search_mode or "auto").lower()
        if mode not in ("auto", "kappa_only", "m_grid"):
            raise HTTPException(status_code=422, detail="search_mode must be auto | kappa_only | m_grid")
        persist_kappa_only = (mode == "kappa_only") or (mode == "auto" and c3out_active)
        origin = self._store_origin(db, store_id)
        if not selection_id:
            selection_id = f"quarter_{origin.year}_Q{(origin.month - 1) // 3 + 1}"
        selection_id = self.tag_selection_id(selection_id, store_id)
        o_idx = pc.date_to_day_index(origin)
        tau_q = min(0.999, max(0.5, float(target_availability)))
        setpoint = min(0.999, float(target_availability) + pc.GUARD)
        now = datetime.now(timezone.utc)
        results: List[Dict[str, Any]] = []

        def _fields(prefix: str, c: Optional[Dict[str, Any]]) -> Dict[str, Any]:
            return {
                f"{prefix}_m_g": None if c is None else c["m"],
                f"{prefix}_kappa_g": None if c is None else c["kappa"],
                f"{prefix}_val_cost": None if c is None else c["cost"],
                f"{prefix}_val_service": None if c is None else c["availability"],
                f"{prefix}_is_feasible": None if c is None else c["is_feasible"],
            }

        for class_id in pc.ALL_CLASSES:
            default = self.DEFAULT_OPTIMAL_POLICIES[class_id]
            scored = self.evaluate_class_candidates(
                db, store_id, class_id, o_idx, pc.VALIDATION_PERIODS, tau_q,
                list(pc.M_GRID), list(pc.KAPPA_GRID), theta=0.0,
            )
            k_best = m_best = None
            if scored is None:
                # no validation data: neutral policy, explicitly NOT feasible and without invented metrics
                best = {"m": default["m_g"], "kappa": default["kappa_g"], "cost": None, "availability": None,
                        "is_feasible": False}
                n_items, n_rev = 0, 0
            else:
                res, n_items, reviews = scored
                k_best = policy_backtest.select_candidate(
                    res, target_availability, pc.GUARD, mask=np.isclose(res.m, 0.0))
                m_best = policy_backtest.select_candidate(res, target_availability, pc.GUARD)
                best = k_best if persist_kappa_only else m_best
                n_rev = len(reviews)

            existing = db.query(PolicySelection).filter(
                PolicySelection.selection_id == selection_id, PolicySelection.class_id == class_id).first()
            if existing:
                existing.m_g, existing.kappa_g = best["m"], best["kappa"]
                existing.val_cost, existing.val_service = best["cost"], best["availability"]
                existing.is_feasible = best["is_feasible"]
                existing.guard = pc.GUARD
                existing.setpoint = setpoint
                existing.tau = tau_q
                existing.source = "j5_backtest"
                existing.created_at = now
            else:
                db.add(PolicySelection(
                    selection_id=selection_id, class_id=class_id, policy_type="REFIT_RSS_EOQ_G",
                    m_g=best["m"], kappa_g=best["kappa"], tau=tau_q, setpoint=setpoint,
                    guard=pc.GUARD, gain_eta=pc.CONTROLLER_ETA, val_cost=best["cost"],
                    val_service=best["availability"], is_feasible=best["is_feasible"],
                    econ_service=pc.TARGET_AVAILABILITY, source="j5_backtest", created_at=now,
                ))
            results.append({
                "selection_id": selection_id, "class_id": class_id, "policy_type": "REFIT_RSS_EOQ_G",
                "m_g": best["m"], "kappa_g": best["kappa"], "val_cost": best["cost"],
                "val_service": best["availability"], "is_feasible": best["is_feasible"],
                "setpoint": setpoint, "n_items": n_items, "n_validation_reviews": n_rev,
                "c3out_active": bool(c3out_active),
                "search_mode": "kappa_only" if persist_kappa_only else "m_grid",
                "source": "j5_backtest",
                **_fields("kappa_only", k_best), **_fields("m_grid", m_best),
            })
        db.commit()
        return results


optimization_service = OptimizationService()
