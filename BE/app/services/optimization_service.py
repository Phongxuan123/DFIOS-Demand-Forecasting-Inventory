import json
import math
import warnings
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
from app.models.forecast_window_quantile import ForecastWindowQuantile
from app.models.sales_history import SalesHistory
from app.models.inventory_param import InventoryParam
from app.models.user import User
from app.models.policy_selection import PolicySelection
from app.models.classification import SKUClassification
from app.models.sim_clock import SimClock
from app.services import policy_config as pc
from app.services import policy_backtest
from app.services import e10b_replay
from app.services.calibrator_service import calibrator_service, selection_store
from app.services.window_quantile_service import (
    WindowQuantileService,
    build_actuals_matrix,
    window_quantile_service,
)
from app.repositories import price_history_repository
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
    # A3 cost rates: read ``pc.HOLDING_RATE_DAILY`` / ``pc.STOCKOUT_PENALTY_RATE`` / ``pc.ORDER_COST_C`` at call time
    # (configurable on Settings, demo.md §1.3); never copy them into class attributes.
    DEFAULT_HOLDING_COST = 2.5
    DEFAULT_LEAD_TIME = pc.LEAD_TIME_DAYS
    DEFAULT_REVIEW_PERIOD = pc.REVIEW_PERIOD_DAYS

    # Neutral starting policy before any J5 measurement (m_g = 0, kappa_g = 1). Once J5 has run, m_g comes from the
    # full grid and the C3-OUT theta is added on top (teacher, G-16). val_cost / val_service are NOT invented.
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
        with np.errstate(all="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN rows (no known day) -> NaN, skipped below
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
            found.update(  # P2: imported teacher window quantiles also back the ML path
                r[0] for r in db.query(ForecastWindowQuantile.item_id)
                .filter(ForecastWindowQuantile.store_id == store_id, ForecastWindowQuantile.item_id.in_(chunk),
                        ForecastWindowQuantile.route == pc.ROUTE_TEACHER)
                .distinct().all()
            )
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
        # G-37: price of the review day (price_history), else the constant products.price
        day_price = price_history_repository.price_map_on(
            db, store_id, item_ids, origin_date, fallback={p.item_id: p.price for p in products})

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
            stats_map = self._demand_stats(db, store_id, ml_ids, origin_date, pc.EOQ_MEAN_WINDOW_DAYS)
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
                # teacher: s = ceil(Q_hat * exp(m_g + theta_g) - 1e-9), theta ADDED on top of the J5 grid m_g
                s_val = float(math.ceil(q_hat * math.exp(m_g + theta) - policy_backtest.CEIL_EPS))
                # G-10: EOQ mean = mean of ACTUAL daily sales of the previous 56 days (0 without sales; no forecast)
                mean_d, std_d = stats_map.get(iid, (0.0, 0.0))
                results.append(self._finish_params(
                    prod, store_id, lt, tau_of[iid], s_val, kappa, max(0.0, float(mean_d)), std_d or 0.0,
                    source="ml", model_run_id="REFIT-RSS-EOQ-G", teacher_eoq=True,
                    extra={"segment": segment, "m_g": m_g, "kappa_g": kappa, "theta_g": theta, "q_hat": q_hat},
                    unit_price=day_price.get(iid),
                ))
        static_ids = [p for p in products if p.item_id not in ml_set]
        if static_ids:
            stats_map = self._demand_stats(db, store_id, [p.item_id for p in static_ids], origin_date, 90)
            for p in static_ids:
                results.append(self._static_from_stats(
                    p, store_id, lt_of[p.item_id], tau_of[p.item_id], stats_map.get(p.item_id),
                    unit_price=day_price.get(p.item_id)))
        return results

    def _finish_params(
        self, prod: Product, store_id: str, lt: int, tau: float, s_val: float, kappa: float,
        mean_demand: float, std_demand: float, source: str, model_run_id: str,
        extra: Optional[Dict[str, Any]] = None, teacher_eoq: bool = False, unit_price: Optional[float] = None,
    ) -> Dict[str, Any]:
        """EOQ, S = s + ceil(kappa * EOQ), SS, costs (A3) from s. Shared by ML and static paths.
        ``teacher_eoq`` (ML / REFIT-RSS-EOQ-G path, G-08/G-12): EOQ = sqrt(2 c mu / (h p)) with mu the 56-day mean
        of actual sales and p the SKU price, no rounding and no floor; S = s + ceil(kappa * EOQ - 1e-9).
        The static baseline keeps its classic rounded EOQ (>= 1).
        ``unit_price`` (G-37): the price of the review day (``price_history``); None -> the constant products.price."""
        if unit_price is None or not unit_price > 0:
            unit_price = float(prod.price) if prod.price and float(prod.price) > 0 else 10.0
        unit_price = float(unit_price)
        h_cost = max(0.2, round(pc.HOLDING_RATE_DAILY * 365.0 * unit_price, 3))
        if teacher_eoq:
            annual_demand = round(max(0.0, mean_demand) * 365.0, 2)
            eoq = float(self.teacher_eoq(np.array([mean_demand]), np.array([unit_price]))[0])
            S_val = float(s_val + math.ceil(kappa * eoq - policy_backtest.CEIL_EPS))
        else:
            annual_demand = max(1.0, round(mean_demand * 365.0, 2))
            eoq = max(1.0, round(math.sqrt((2.0 * annual_demand * pc.ORDER_COST_C) / h_cost), 1))
            S_val = float(s_val + math.ceil(kappa * eoq))
        d_l = round(mean_demand * lt, 2)
        out = {
            "item_id": prod.item_id,
            "safety_stock": max(0.0, round(s_val - d_l, 2)),
            "reorder_point": s_val, "eoq": eoq, "s": s_val, "S": S_val,
            "model_run_id": model_run_id, "annual_demand": annual_demand,
            "holding_cost": h_cost, "order_cost": pc.ORDER_COST_C, "unit_price": unit_price,
            "source": source, "d_l": d_l, "lead_time_days": lt, "service_level": tau,
            "sigma_d": round(max(0.2, std_demand), 2),
            "sigma_l": round(max(0.2, std_demand) * math.sqrt(lt), 2),
        }
        if extra:
            out.update(extra)
        return out

    def _static_from_stats(
        self, prod: Product, store_id: str, lt: int, tau: float, stats_pair: Optional[Tuple[float, float]],
        unit_price: Optional[float] = None,
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
            source="static", model_run_id="static-moving-avg", unit_price=unit_price,
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
        day_price = price_history_repository.price_map_on(db, store_id, [item_id], origin,
                                                          fallback={item_id: prod.price}).get(item_id)
        if stats_pair is None:  # sales newer than the clock (e.g. no clock yet): use the latest rows
            q = (db.query(SalesHistory.quantity)
                 .filter(SalesHistory.item_id == item_id, SalesHistory.store_id == store_id)
                 .order_by(SalesHistory.sale_date.desc()).limit(90).all())
            if q:
                arr = np.array([float(r[0] or 0.0) for r in q])
                stats_pair = (float(arr.mean()), float(arr.std()) if len(arr) > 1 else 0.0)
        return self._static_from_stats(prod, store_id, lead_time_days, tau, stats_pair, unit_price=day_price)

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
        n_skipped = 0

        for p in params:
            prod = prod_map.get(p.item_id)
            prod_name = prod.name if prod else p.item_id
            cat_id = prod.cat_id if prod else "FOODS"
            ml_ss = float(p.safety_stock or 0.0)
            ml_rop = float(p.reorder_point or 0.0)
            ml_eoq = float(p.eoq or 1.0)
            price = float(prod.price) if prod and prod.price and prod.price > 0 else float(p.unit_price or 10.0)
            h_cost = float(p.holding_cost or round(pc.HOLDING_RATE_DAILY * 365.0 * price, 3))
            o_cost = float(p.order_cost or pc.ORDER_COST_C)
            lt_days = int(p.lead_time_days or self.DEFAULT_LEAD_TIME)
            tau = float(p.service_level or 0.95)
            tau_safe = min(max(tau, 0.50), 0.999)
            if p.item_id in dstats:
                avg_daily, sigma_d = dstats[p.item_id]
            elif p.annual_demand:
                avg_daily, sigma_d = max(0.1, float(p.annual_demand) / 365.0), 0.0
            else:  # round 5: no observed demand and no parameter demand -> not compared (no invented 36.5/year)
                n_skipped += 1
                continue
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
            n_items_skipped=n_skipped,
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

    # --- Job J5: policy selection (teacher E10b REFIT-RSS-EOQ-G; docs/teacher_map/00_INDEX.md sec. 3, 9, 12) ---

    def _c3out_active(self, db: Session) -> bool:
        """P6 (C3-OUT) is the deployed controller unless the setting ``c3out_active`` says otherwise."""
        s = system_setting_repository.get_by_key(db, "c3out_active")
        if not s:
            return True
        v = s.value
        if isinstance(v, dict):
            v = v.get("enabled", v.get("value", True))
        return str(v).strip().lower() not in ("0", "false", "no", "off")

    def _simulation_reviews(self, db: Session, store_id: str, item_ids: List[str], o_idx: int) -> List[int]:
        """Review days of the continuous J5 simulation: the longest chain of consecutive (spacing R) backtest reviews
        that ends with the last review whose period [s, s + R) is fully observed before the refit day ``o_idx``.
        Its first review is the simulation start (teacher: VAL_START, the first forecast origin)."""
        R = pc.REVIEW_PERIOD_DAYS
        days: set = set()
        # P2: imported teacher quantiles define the review chain when present (teacher: from VAL_START, step R)
        teacher_days = set(window_quantile_service.teacher_review_days(db, store_id, pc.HORIZON_DAYS))
        if teacher_days:
            grid_origin = min(teacher_days)
            teacher_days = {d for d in teacher_days if (d - grid_origin) % R == 0}
        days.update(teacher_days)
        for k in range(0, 0 if days else len(item_ids), 900):
            days.update(
                int(r[0]) for r in db.query(ForecastBacktest.review_day)
                .filter(ForecastBacktest.store_id == store_id, ForecastBacktest.item_id.in_(item_ids[k:k + 900]))
                .distinct().all()
            )
        eligible = sorted(d for d in days if d + R <= o_idx)
        if not eligible:
            return []
        chain = [eligible[-1]]
        have = set(eligible)
        while chain[-1] - R in have:
            chain.append(chain[-1] - R)
        return sorted(chain)

    # kept for backward compatibility (old name)
    def _validation_reviews(self, db: Session, store_id: str, item_ids: List[str], o_idx: int,
                            n_periods: Optional[int] = None) -> List[int]:
        chain = self._simulation_reviews(db, store_id, item_ids, o_idx)
        return chain[-int(n_periods):] if n_periods else chain

    @staticmethod
    def teacher_eoq(mu_daily: np.ndarray, price: np.ndarray) -> np.ndarray:
        """G-08/G-10/G-12: EOQ = sqrt(2 c mu / (h p)), mu = mean ACTUAL daily sales of the previous 56 days, p = the
        SKU price; no rounding, no floor of 1 (EOQ = 0 without sales)."""
        mu = np.maximum(np.nan_to_num(np.asarray(mu_daily, dtype=float), nan=0.0), 0.0)
        p = np.asarray(price, dtype=float)
        with np.errstate(divide="ignore", invalid="ignore"):
            eoq = np.sqrt(2.0 * pc.ORDER_COST_C * mu / (pc.HOLDING_RATE_DAILY * p))
        return np.where(np.isfinite(eoq), eoq, 0.0)

    @staticmethod
    def score_window(
        dem: np.ndarray, q: np.ndarray, eoq: np.ndarray, price: np.ndarray, history: Optional[np.ndarray],
        m_values: List[float], kappa_values: List[float], window_start_review: int, theta: float = 0.0,
        lead_time: int = pc.LEAD_TIME_DAYS, review_period: int = pc.REVIEW_PERIOD_DAYS,
        daily_price: Optional[np.ndarray] = None,
    ) -> Dict[str, Any]:
        """Teacher scoring of every (m, kappa): ONE continuous simulation from the first review (the engine
        ``policy_backtest.simulate_rss_candidates``), scored on the window that starts at review index
        ``window_start_review`` and ends with the segment (only reviews in the window, only complete cycles; costs of
        the window days and order lines of the window reviews) - exactly ``e10b_replay.window_stats``.

        The engine is causal, so the window figures are differences of the full run and two prefix runs of the same
        dynamics: [start, lo) for the costs and [start, lo + R*ceil(L/R)) for the cycles (its complete cycles are
        exactly the reviews before lo)."""
        L, R = int(lead_time), int(review_period)
        n, T = dem.shape
        K = q.shape[1]
        kw = int(window_start_review)

        def run(k_end: int) -> policy_backtest.BacktestResult:
            return policy_backtest.simulate_rss_candidates(
                dem[:, :k_end * R], q[:, :k_end], eoq[:, :k_end], price, m_values, kappa_values, theta=theta,
                lead_time=L, review_period=R, history_demand=history,
                daily_price=None if daily_price is None else daily_price[:, :k_end * R],
            )

        full = run(K)
        C = len(full.cost)

        def counts(res: policy_backtest.BacktestResult) -> np.ndarray:
            if not res.n_cycles:
                return np.zeros(C)
            return np.asarray(res.availability, dtype=float) * n * res.n_cycles

        cost = np.asarray(full.cost, dtype=float).copy()
        lost = np.asarray(full.lost_units, dtype=float).copy()
        demand = float(full.demand_units)
        av_cnt = counts(full)
        n_cyc = int(full.n_cycles)
        if kw > 0:
            pre = run(kw)
            cost -= pre.cost
            lost -= pre.lost_units
            demand -= float(pre.demand_units)
            kc = min(K, kw + int(math.ceil(L / R)))
            pre_c = run(kc) if kc != kw else pre
            av_cnt = av_cnt - counts(pre_c)
            n_cyc -= int(pre_c.n_cycles)
        avail = av_cnt / (n * n_cyc) if n_cyc > 0 and n > 0 else np.full(C, np.nan)
        fill = 1.0 - lost / demand if demand > 0 else np.ones(C)
        return {"m": np.asarray(full.m), "kappa": np.asarray(full.kappa), "cost": cost, "availability": avail,
                "fill_rate": fill, "n_cycles": n_cyc, "n_items": n, "full": full}

    def evaluate_class_candidates(
        self, db: Session, store_id: str, class_id: str, o_idx: int,
        window_days: int = pc.SELECTION_WINDOW_DAYS, tau_q: float = pc.QUANTILE_TAU,
        m_values: Optional[List[float]] = None, kappa_values: Optional[List[float]] = None, theta: float = 0.0,
    ) -> Optional[Tuple[Dict[str, Any], int, List[int]]]:
        """Score every (m, kappa) of one class (teacher E10b):
          * one continuous simulation per candidate from the simulation start (first review of the chain), initial
            stock round(mean 28 days * (L + R)), Q_hat at tau = 0.95 (teacher route (c)), EOQ from the 56-day mean
            of actual sales and the SKU price, batch ceil(kappa * EOQ - 1e-9);
          * scored on the ``window_days`` (182) days ending at the refit day (complete cycles only).
        Returns (scores, n_items, review_days) or None when the class has no usable data."""
        m_values = list(pc.M_GRID) if m_values is None else list(m_values)
        kappa_values = list(pc.KAPPA_GRID) if kappa_values is None else list(kappa_values)
        item_ids = [r[0] for r in db.query(SKUClassification.item_id)
                    .filter(SKUClassification.store_id == store_id, SKUClassification.segment == class_id).all()]
        if not item_ids:
            return None
        reviews = self._simulation_reviews(db, store_id, item_ids, o_idx)
        if len(reviews) < 2:
            return None
        R, L, H = pc.REVIEW_PERIOD_DAYS, pc.LEAD_TIME_DAYS, pc.HORIZON_DAYS
        start, end = reviews[0], reviews[-1] + R
        cm = window_quantile_service.causal_quantile_matrix(db, store_id, item_ids, reviews, tau_q, H)
        hist_lo = max(0, start - max(pc.EOQ_MEAN_WINDOW_DAYS, pc.INIT_STOCK_WINDOW_DAYS))
        A = build_actuals_matrix(db, store_id, item_ids, hist_lo, end)
        off = start - hist_lo
        dem = A[:, off:]
        # an item without a real price is EXCLUDED (A3 costs are price-proportional; no invented price 10)
        price = price_history_repository.constant_prices(db, item_ids)
        # G-37: price of every simulated day (price_history, else products.price); holding / lost are valued at the
        # price of their day and the EOQ of review k at the price of the review day
        p_day = price_history_repository.price_matrix(
            db, store_id, item_ids, pc.day_index_to_date(start), pc.day_index_to_date(end), fallback=price)
        ok = (~np.isnan(dem).any(axis=1) & ~np.isnan(cm["q"]).any(axis=1)
              & ~np.isnan(p_day).any(axis=1) & ~(p_day <= 0).any(axis=1))
        if ok.sum() == 0:
            return None
        A, dem, q, price, p_day = A[ok], dem[ok], cm["q"][ok], price[ok], p_day[ok]
        price = np.where(np.isnan(price), p_day[:, 0], price)
        # EOQ_k from the mean of the actual sales of the 56 days before review k (NaN days ignored, none -> 0)
        mu = np.zeros((len(price), len(reviews)))
        with np.errstate(all="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            for k, r in enumerate(reviews):
                a = max(hist_lo, r - pc.EOQ_MEAN_WINDOW_DAYS) - hist_lo
                blk = A[:, a:r - hist_lo]
                mu[:, k] = np.nan_to_num(np.nanmean(blk, axis=1), nan=0.0) if blk.shape[1] else 0.0
        eoq = self.teacher_eoq(mu, p_day[:, [r - start for r in reviews]])
        history = A[:, max(0, off - pc.INIT_STOCK_WINDOW_DAYS):off] if off > 0 else None
        if history is not None and history.shape[1] == 0:
            history = None
        lo_day = max(start, end - int(window_days))
        kw = int(math.ceil((lo_day - start) / R))
        scores = self.score_window(dem, q, eoq, price, history, m_values, kappa_values, kw, theta=theta,
                                   lead_time=L, review_period=R, daily_price=p_day)
        scores["window"] = (start + kw * R, end)
        scores["simulation_start"] = start
        return scores, int(ok.sum()), reviews

    @staticmethod
    def choose_candidate(scores: Dict[str, Any], guard: float = pc.SELECTION_GUARD_AVAILABILITY,
                         mask: Optional[np.ndarray] = None) -> Optional[Dict[str, Any]]:
        """Teacher ``choose`` (``e10b_replay.choose``): cheapest candidate with availability >= guard; else the
        smallest shortfall, then the lowest cost. A candidate without a complete cycle is never feasible."""
        idx = np.arange(len(scores["cost"])) if mask is None else np.flatnonzero(np.asarray(mask, dtype=bool))
        if len(idx) == 0:
            return None
        av = np.asarray(scores["availability"], dtype=float)
        av_sel = np.nan_to_num(av[idx], nan=-1.0)
        j = int(idx[e10b_replay.choose(np.asarray(scores["cost"], dtype=float)[idx], av_sel, guard)])
        a = float(av[j])
        return {
            "m": float(scores["m"][j]), "kappa": float(scores["kappa"][j]), "cost": float(scores["cost"][j]),
            "availability": None if math.isnan(a) else a, "fill_rate": float(scores["fill_rate"][j]),
            "is_feasible": bool(not math.isnan(a) and a >= guard - 1e-12), "index": j,
        }

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
        Job J5 - re-select (m_g, kappa_g) per ABC-XYZ class, teacher E10b (REFIT-RSS-EOQ-G):
          * every (m, kappa) of the grid m in [-0.7, 2.0] step 0.1 x kappa in {0, 0.5, 1, 1.5, 2} (140 candidates)
            is simulated ONCE continuously from the simulation start and scored on the 182 days (26 weeks) ending at
            the refit day (complete cycles only), Q_hat at tau = 0.95;
          * per class ``choose``: cheapest candidate with availability >= guard (0.96 = 0.95 + 0.01; an explicit
            ``target_availability`` gives target + 0.01); if none, the smallest shortfall, then the lowest cost;
          * search_mode: ``m_grid`` (DEFAULT, also ``auto``): full grid, the C3-OUT theta is ADDED on top of m_g
            online; ``kappa_only``: ABLATION only (m forced to 0, the old DFIOS mode). Both are reported (Q-08);
          * the controller setpoint written with the selection is the guard (0.96 by default);
          * selection ids are store-scoped (Q-05). The refit cadence (every 91 days) belongs to the caller.
        """
        pc.sync_costs(db)  # demo.md §1.3: the configured h, b, c
        guard = (pc.SELECTION_GUARD_AVAILABILITY if target_availability is None
                 else min(0.999, float(target_availability) + pc.GUARD))
        if c3out_active is None:
            c3out_active = self._c3out_active(db)
        mode = (search_mode or "auto").lower()
        if mode not in ("auto", pc.J5_SEARCH_MODE_ABLATION, pc.J5_SEARCH_MODE_DEFAULT):
            raise HTTPException(status_code=422, detail="search_mode must be auto | m_grid | kappa_only (ablation)")
        persist_kappa_only = mode == pc.J5_SEARCH_MODE_ABLATION
        origin = self._store_origin(db, store_id)
        if not selection_id:
            selection_id = f"quarter_{origin.year}_Q{(origin.month - 1) // 3 + 1}"
        selection_id = self.tag_selection_id(selection_id, store_id)
        o_idx = pc.date_to_day_index(origin)
        tau_q = pc.QUANTILE_TAU
        setpoint = guard
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
                db, store_id, class_id, o_idx, pc.SELECTION_WINDOW_DAYS, tau_q,
                list(pc.M_GRID), list(pc.KAPPA_GRID), theta=0.0,
            )
            k_best = m_best = None
            window = None
            if scored is not None and scored[0]["n_cycles"] > 0:
                sc, n_items, reviews = scored
                k_best = self.choose_candidate(sc, guard, mask=np.isclose(sc["m"], 0.0))
                m_best = self.choose_candidate(sc, guard)
                best = k_best if persist_kappa_only else m_best
                n_rev = int(sc["n_cycles"])
                window = [pc.day_index_to_date(sc["window"][0]).isoformat(),
                          pc.day_index_to_date(sc["window"][1] - 1).isoformat()]
            else:
                # no scorable window: neutral policy, explicitly NOT feasible and without invented metrics
                best = {"m": default["m_g"], "kappa": default["kappa_g"], "cost": None, "availability": None,
                        "is_feasible": False}
                n_items = scored[1] if scored is not None else 0
                n_rev = 0

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
                "setpoint": setpoint, "guard_availability": guard, "n_items": n_items,
                "n_validation_reviews": n_rev, "selection_window": window,
                "c3out_active": bool(c3out_active),
                "search_mode": pc.J5_SEARCH_MODE_ABLATION if persist_kappa_only else pc.J5_SEARCH_MODE_DEFAULT,
                "source": "j5_backtest",
                **_fields("kappa_only", k_best), **_fields("m_grid", m_best),
            })
        db.commit()
        return results


optimization_service = OptimizationService()
