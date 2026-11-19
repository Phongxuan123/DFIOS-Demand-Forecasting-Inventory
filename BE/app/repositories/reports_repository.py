from datetime import date
import math
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.classification import SKUClassification
from app.models.forecast import Forecast
from app.models.inventory import Inventory
from app.models.inventory_daily import InventoryDaily
from app.models.inventory_param import InventoryParam
from app.models.model_registry import ModelRegistry
from app.models.product import Product
from app.models.replenishment import ReplenishmentRecommendation
from app.models.sales_history import SalesHistory
from app.models.sim_clock import SimClock
from app.models.sim_state import SimShadowDaily
from app.repositories import price_history_repository
from app.services import policy_config as pc

_GLOBAL = ("GLOBAL", "ALL")
_EMPTY_METRICS = {"mae": None, "rmse": None, "mase": None, "wrmsse": None, "sample_count": 0}


def _is_global(store_id: Optional[str]) -> bool:
    return not store_id or not store_id.strip() or store_id.strip().upper() in _GLOBAL


class ReportsRepository:
    """
    Repository truy vấn và tính toán số liệu phân tích chuyên sâu cho Module H — Reports (UC39 - UC43).
    Quy tắc: mọi số liệu hoặc được TÍNH từ dữ liệu, hoặc là null kèm lý do. Không có hằng số CSL / fill rate nhúng sẵn.
    """

    # ------------------------------------------------------------------ UC39
    def get_forecast_accuracy_report(
        self,
        db: Session,
        model_name: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        store_id: Optional[str] = None,
        abc_class: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        UC39: MAE, RMSE, MASE, WRMSSE theo nhóm ABC.
        R-02: scale (MASE/RMSSE) = sai phân 1 bước của naive trên LỊCH SỬ HUẤN LUYỆN (trước cửa sổ đánh giá);
        trọng số WRMSSE = doanh thu (USD) 28 ngày cuối của lịch sử huấn luyện; truy vấn có ORDER BY xác định;
        chuỗi theo (item, store). Chuỗi không có lịch sử >= 2 ngày bị loại khỏi MASE/WRMSSE (không chặn cứng).
        ``model_name`` None = the Production model of the registry (the model of the dashboard WRMSSE card).
        """
        query = (
            db.query(
                Forecast.item_id,
                Forecast.store_id,
                Forecast.forecast_date,
                Forecast.y_pred,
                SalesHistory.quantity.label("actual_qty"),
                func.coalesce(SKUClassification.abc_class, "B").label("abc_class"),
            )
            .join(
                SalesHistory,
                (Forecast.item_id == SalesHistory.item_id)
                & (Forecast.store_id == SalesHistory.store_id)
                & (Forecast.forecast_date == SalesHistory.sale_date),
            )
            .outerjoin(
                SKUClassification,
                (Forecast.item_id == SKUClassification.item_id) & (Forecast.store_id == SKUClassification.store_id),
            )
        )
        if not _is_global(store_id):
            query = query.filter(Forecast.store_id == store_id.strip())
        if start_date:
            query = query.filter(Forecast.forecast_date >= start_date)
        if end_date:
            query = query.filter(Forecast.forecast_date <= end_date)
        if abc_class and abc_class.strip():
            query = query.filter(SKUClassification.abc_class == abc_class.strip().upper())
        rows = query.order_by(Forecast.item_id, Forecast.store_id, Forecast.forecast_date).all()

        if not rows:
            return self._accuracy_from_registry(db, model_name, store_id, start_date, end_date)

        eval_start = min(r.forecast_date for r in rows)
        eval_end = max(r.forecast_date for r in rows)

        series: Dict[Tuple[str, str], Dict[str, Any]] = {}
        for r in rows:
            key = (r.item_id, r.store_id)
            sd = series.setdefault(key, {"err": [], "act": [], "abc": r.abc_class if r.abc_class in ("A", "B", "C") else "B"})
            pred = float(r.y_pred or 0.0)
            act = float(r.actual_qty or 0.0)
            sd["err"].append(pred - act)
            sd["act"].append(act)

        # training history strictly before the evaluation window (R-02)
        keys = list(series.keys())
        item_ids = sorted({k[0] for k in keys})
        hist_q = (
            db.query(SalesHistory.item_id, SalesHistory.store_id, SalesHistory.sale_date, SalesHistory.quantity)
            .filter(SalesHistory.item_id.in_(item_ids), SalesHistory.sale_date < eval_start)
            .order_by(SalesHistory.item_id, SalesHistory.store_id, SalesHistory.sale_date)
        )
        if not _is_global(store_id):
            hist_q = hist_q.filter(SalesHistory.store_id == store_id.strip())
        hist: Dict[Tuple[str, str], List[Tuple[date, float]]] = {}
        for iid, sid, d, q in hist_q.all():
            if (iid, sid) in series:
                hist.setdefault((iid, sid), []).append((d, float(q or 0.0)))

        prices = {
            p.item_id: float(p.price) for p in db.query(Product.item_id, Product.price).filter(Product.item_id.in_(item_ids)).all()
            if p.price is not None
        }
        # G-37: the 28-day dollar sales of a series on a store with daily prices = sum(units of day d * price of d)
        # (price_history, else products.price); ONE price_matrix per such store. Other stores: units * products.price.
        daily_dollar: Dict[Tuple[str, str], Optional[float]] = {}
        for st in sorted({k[1] for k in keys}):
            if not price_history_repository.has_prices(db, st):
                continue
            st_keys = [k for k in keys if k[1] == st and len(hist.get(k, [])) >= 2]
            if not st_keys:
                continue
            st_items = sorted({k[0] for k in st_keys})
            lo = min(hist[k][-28:][0][0] for k in st_keys)
            P = price_history_repository.price_matrix(
                db, st, st_items, lo, eval_start,
                fallback=np.array([prices[i] if i in prices else np.nan for i in st_items], dtype=float))
            pos = {i: j for j, i in enumerate(st_items)}
            for k in st_keys:
                tail = hist[k][-28:]
                p = P[pos[k[0]], [(d - lo).days for d, _ in tail]]
                daily_dollar[k] = None if np.isnan(p).any() else float(np.sum(np.asarray([v for _, v in tail]) * p))

        stats: Dict[Tuple[str, str], Dict[str, float]] = {}
        for key, sd in series.items():
            err = np.asarray(sd["err"], dtype=float)
            n = len(err)
            mae_i = float(np.mean(np.abs(err)))
            rmse_i = float(math.sqrt(np.mean(err ** 2)))
            h = hist.get(key, [])
            scale_mae = scale_rmse = None
            dollar = None
            if len(h) >= 2:
                y = np.asarray([v for _, v in h], dtype=float)
                diff = np.diff(y)
                s_mae, s_rmse = float(np.mean(np.abs(diff))), float(math.sqrt(np.mean(diff ** 2)))
                if s_mae > 0 and s_rmse > 0:
                    scale_mae, scale_rmse = s_mae, s_rmse
                last28 = y[-28:]
                if key in daily_dollar:
                    dollar = daily_dollar[key]
                elif key[0] in prices:
                    dollar = float(last28.sum()) * prices[key[0]]
            stats[key] = {
                "n": n, "mae": mae_i, "rmse": rmse_i, "sq_sum": float(np.sum(err ** 2)), "abs_sum": float(np.sum(np.abs(err))),
                "mase": (mae_i / scale_mae) if scale_mae else None,
                "rmsse": (rmse_i / scale_rmse) if scale_rmse else None,
                "dollar": dollar,
            }

        def agg(keys_: List[Tuple[str, str]]) -> Dict[str, Any]:
            if not keys_:
                return dict(_EMPTY_METRICS)
            n_tot = sum(stats[k]["n"] for k in keys_)
            mae = sum(stats[k]["abs_sum"] for k in keys_) / n_tot
            rmse = math.sqrt(sum(stats[k]["sq_sum"] for k in keys_) / n_tot)
            scaled = [k for k in keys_ if stats[k]["rmsse"] is not None and stats[k]["dollar"] is not None and stats[k]["dollar"] > 0]
            mase = wrmsse = None
            if scaled:
                w = np.asarray([stats[k]["dollar"] for k in scaled], dtype=float)
                w = w / w.sum()
                wrmsse = round(float(np.sum(w * np.asarray([stats[k]["rmsse"] for k in scaled]))), 4)
                mase = round(float(np.sum(w * np.asarray([stats[k]["mase"] for k in scaled]))), 4)
            return {"mae": round(mae, 4), "rmse": round(rmse, 4), "mase": mase, "wrmsse": wrmsse, "sample_count": n_tot}

        all_keys = sorted(stats.keys())
        overall = agg(all_keys)
        abc_breakdown = {g: agg([k for k in all_keys if series[k]["abc"] == g]) for g in ("A", "B", "C")}
        n_scaled = sum(1 for k in all_keys if stats[k]["rmsse"] is not None and stats[k]["dollar"])
        reason = reason_code = None
        if overall["wrmsse"] is None:
            reason_code = "no_training_scale"
            reason = (
                "MASE/WRMSSE không tính được: không chuỗi nào có >= 2 ngày lịch sử huấn luyện trước cửa sổ đánh giá "
                f"({eval_start}) hoặc thiếu giá. MAE/RMSE vẫn tính trực tiếp từ dự báo và doanh số thực."
            )
        elif n_scaled < len(all_keys):
            reason_code = "partial_training_scale"
            reason = f"{len(all_keys) - n_scaled}/{len(all_keys)} chuỗi bị loại khỏi MASE/WRMSSE vì thiếu lịch sử huấn luyện (scale) hoặc giá."

        mae_items = sorted(((stats[k]["mae"], k) for k in all_keys), key=lambda x: (x[0], x[1]))
        needed = [k[0] for _, k in mae_items[:3]] + [k[0] for _, k in mae_items[-2:]]
        names = {p.item_id: p.name for p in db.query(Product).filter(Product.item_id.in_(needed)).all()}

        def entry(m: float, k: Tuple[str, str]) -> Dict[str, Any]:
            m_act = max(1e-9, float(np.mean(series[k]["act"])))
            acc = max(0.0, min(100.0, (1.0 - m / (m_act + m)) * 100.0))
            return {"item_id": k[0], "store_id": k[1], "name": names.get(k[0], k[0]), "mae": round(m, 4), "accuracy_pct": f"{round(acc, 1)}%"}

        return {
            "model_name": model_name or "production",
            "evaluated_period": f"{eval_start} to {eval_end}",
            "store_id": store_id or "All",
            "overall_metrics": overall,
            "abc_breakdown": abc_breakdown,
            "top_accurate_skus": [entry(m, k) for m, k in mae_items[:3]],
            "top_deviating_skus": [entry(m, k) for m, k in reversed(mae_items[-2:])],
            "source": "forecast_vs_sales_history",
            "as_of": str(eval_end),
            "n_skus": len({k[0] for k in all_keys}),
            "n_series_scaled": n_scaled,
            "metrics_reason": reason,
            "metrics_reason_code": reason_code,
            "metrics_reason_params": {"n_excluded": len(all_keys) - n_scaled, "n_series": len(all_keys),
                                      "eval_start": str(eval_start)} if reason_code else {},
        }

    def _accuracy_from_registry(
        self, db: Session, model_name: Optional[str], store_id: Optional[str], start_date: Optional[date],
        end_date: Optional[date],
    ) -> Dict[str, Any]:
        """No forecast/actual overlap: report ONLY the metrics the registry really holds (others null), labelled.
        ``model_name`` None = the Production model (the dashboard reads the same row), never a challenger."""
        q = db.query(ModelRegistry)
        if model_name:
            q = q.filter((ModelRegistry.algorithm == model_name) | (ModelRegistry.name == model_name))
            q = q.order_by(ModelRegistry.is_production.desc(), ModelRegistry.created_at.desc())
        else:
            q = q.filter(ModelRegistry.is_production.is_(True)).order_by(
                ModelRegistry.promoted_at.desc(), ModelRegistry.created_at.desc())
        prod_model = q.first()
        if not model_name:
            model_name = (prod_model.algorithm or prod_model.name) if prod_model else "production"
        metrics = dict(_EMPTY_METRICS)
        source, reason = "none", "Không có dự báo trùng với doanh số thực trong cửa sổ yêu cầu và không có mô hình trong registry."
        reason_code, missing = "no_overlap_no_registry", []
        if prod_model and prod_model.metrics:
            m = prod_model.metrics
            for k in ("mae", "rmse", "mase", "wrmsse"):
                metrics[k] = float(m[k]) if m.get(k) is not None else None
            source = "model_registry"
            reason_code = "registry_fallback"
            missing = [k for k in ("mae", "rmse", "mase", "wrmsse") if metrics[k] is None]
            reason = (
                "Không có dự báo trùng với doanh số thực; số liệu lấy từ model_registry"
                + (f", thiếu: {', '.join(missing)} (không có nguồn)." if missing else ".")
            )
        period = f"{start_date or ''} to {end_date or ''}".strip()
        return {
            "model_name": model_name,
            "evaluated_period": period if period != "to" else "n/a",
            "store_id": store_id or "All",
            "overall_metrics": metrics,
            "abc_breakdown": {g: dict(_EMPTY_METRICS) for g in ("A", "B", "C")},
            "top_accurate_skus": [],
            "top_deviating_skus": [],
            "source": source,
            "as_of": None,
            "n_skus": 0,
            "n_series_scaled": 0,
            "metrics_reason": reason,
            "metrics_reason_code": reason_code,
            "metrics_reason_params": {"missing_metrics": missing},
        }

    # ------------------------------------------------------------------ UC40
    def get_inventory_performance_report(
        self,
        db: Session,
        store_id: Optional[str] = None,
        category: Optional[str] = None,
        limit: Optional[int] = 50,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """
        UC40: Vòng quay tồn kho và Days of Supply. Nhu cầu ngày = annual_demand/365 của inventory_params;
        SKU chưa có tham số -> daily_demand/days_of_supply/turnover = null (không giả định 365/năm hay giá 10).
        """
        query = (
            db.query(
                Inventory.item_id,
                func.coalesce(Product.name, Inventory.item_id).label("product_name"),
                func.coalesce(Product.cat_id, "UNKNOWN").label("category"),
                Inventory.store_id,
                Inventory.on_hand,
                Product.price.label("price"),
                InventoryParam.unit_price.label("param_price"),
                InventoryParam.annual_demand.label("annual_demand"),
            )
            .outerjoin(Product, Inventory.item_id == Product.item_id)
            .outerjoin(
                InventoryParam,
                (Inventory.item_id == InventoryParam.item_id) & (Inventory.store_id == InventoryParam.store_id),
            )
        )
        if not _is_global(store_id):
            query = query.filter(Inventory.store_id == store_id.strip())
        if category and category.strip() and category.upper() != "ALL":
            query = query.filter(Product.cat_id == category.strip())
        records = query.order_by(Inventory.store_id, Inventory.item_id).all()

        # G-37: stock is valued at the price of the valuation date = the store's simulated clock date (the date of the
        # on-hand quantity): price_history of that day, else products.price, else inventory_params.unit_price, else 0.
        def base_price(r) -> float:
            return float(r.price if r.price is not None else (r.param_price if r.param_price is not None else 0.0))

        day_price: Dict[Tuple[str, str], float] = {}
        valuation_dates: Dict[str, str] = {}
        clock_of = {c.store_id: c.current_date for c in db.query(SimClock.store_id, SimClock.current_date).all()}
        for st in sorted({r.store_id for r in records}):
            vd = clock_of.get(st)
            if vd is None or not price_history_repository.has_prices(db, st):
                continue
            st_recs = [r for r in records if r.store_id == st]
            p = price_history_repository.price_on(
                db, st, [r.item_id for r in st_recs], vd, fallback=np.array([base_price(r) for r in st_recs]))
            for r, v in zip(st_recs, p):
                day_price[(st, r.item_id)] = float(v)
            valuation_dates[st] = str(vd)

        total_value = dead_stock_val = 0.0
        stockout_count = 0
        turnovers: List[float] = []
        dos_list: List[float] = []
        item_list = []
        for r in records:
            on_hand = max(0.0, float(r.on_hand or 0.0))
            price = day_price.get((r.store_id, r.item_id), base_price(r))
            val = round(on_hand * price, 2)
            total_value += val
            if on_hand <= 0.0:
                stockout_count += 1
            ann = float(r.annual_demand) if r.annual_demand is not None and float(r.annual_demand) > 0 else None
            daily = round(ann / 365.0, 4) if ann else None
            dos = turnover = None
            if daily:
                dos = 0.0 if on_hand <= 0 else round(on_hand / daily, 1)
                turnover = 0.0 if on_hand <= 0 else round(ann / on_hand, 2)
                turnovers.append(turnover)
                dos_list.append(dos)
                if on_hand > 0 and dos > 180:
                    dead_stock_val += val
            item_list.append({
                "item_id": r.item_id, "product_name": r.product_name, "category": r.category, "store_id": r.store_id,
                "on_hand": on_hand, "daily_demand": daily, "days_of_supply": dos, "inventory_value": val,
                "turnover_ratio": turnover,
            })
        paginated = item_list[offset: offset + limit] if limit is not None else item_list[offset:]
        reason = None
        if records and not turnovers:
            reason = "Không SKU nào có annual_demand trong inventory_params: chưa tính được vòng quay / days of supply."
        return {
            "store_id": store_id or "All",
            "total_inventory_value": round(total_value, 2),
            "average_turnover_ratio": round(sum(turnovers) / len(turnovers), 2) if turnovers else None,
            "average_days_of_supply": round(sum(dos_list) / len(dos_list), 1) if dos_list else None,
            "stockout_skus_count": stockout_count,
            "dead_stock_value": round(dead_stock_val, 2),
            "items": paginated,
            "total": len(records),
            "source": "inventory+inventory_params",
            "price_valuation_dates": valuation_dates,
            "n_skus": len(records),
            "n_skus_with_demand": len(turnovers),
            "reason": reason,
            "reason_code": "no_annual_demand" if reason else None,
        }

    # ------------------------------------------------------------------ simulator window helpers
    @staticmethod
    def _sim_window(db: Session, store_id: Optional[str]) -> Tuple[List[str], Optional[date], Optional[date]]:
        q = db.query(SimClock)
        if not _is_global(store_id):
            q = q.filter(SimClock.store_id == store_id.strip())
        clocks = q.all()
        if not clocks:
            return [], None, None
        return [c.store_id for c in clocks], min(c.start_date for c in clocks), max(c.current_date for c in clocks)

    # ------------------------------------------------------------------ UC41
    def run_historical_backtest(
        self,
        db: Session,
        model_name: str = "lightgbm",
        backtest_days: int = 28,
        store_id: str = "CA_1",
        target_service_level: float = 0.95,
    ) -> Dict[str, Any]:
        """
        UC41: kết quả ĐO của bộ mô phỏng: C³-OUT (chính sách chạy) so với B0 shadow song song trên cùng nhu cầu.
        Không có CSL / fill-rate nhúng sẵn. Chưa mô phỏng -> các chỉ số null + reason.
        """
        from app.services.dashboard_service import dashboard_service, kpi_reason_code, valued_stock_sums

        stores, start, end = self._sim_window(db, store_id)
        base = {
            "model_name": model_name, "store_id": store_id, "simulated_days": 0, "baseline_stockouts": None,
            "ml_stockouts": None, "stockout_reduction_pct": None, "baseline_avg_inventory": None,
            "ml_avg_inventory": None, "holding_cost_savings": None, "service_level_achieved": None,
            "source": "simulator", "as_of": str(end) if end else None, "n_skus": None,
            "target_service_level": target_service_level, "reason": None, "reason_code": None,
        }
        if not stores:
            base["reason"] = "Không có sim_clock cho cửa hàng."
            base["reason_code"] = "no_clock"
            return base
        days = (end - start).days
        base["simulated_days"] = days
        base["n_skus"] = db.query(func.count(Inventory.item_id)).filter(Inventory.store_id.in_(stores)).scalar() or None
        avail, c3_reason, b0_reason = dashboard_service._availability_by_class(db, stores, start, end, pc.REVIEW_PERIOD_DAYS)
        if c3_reason is not None:
            base["reason"] = c3_reason
            base["reason_code"] = kpi_reason_code(c3_reason)
            return base
        n_periods = sum(a["n_periods"] for a in avail.values())
        ml_so = sum(a["c3_stockout"] for a in avail.values())
        base["ml_stockouts"] = ml_so
        base["service_level_achieved"] = round((1.0 - ml_so / n_periods) * 100.0, 2) if n_periods else None
        if b0_reason is not None:
            base["reason"] = b0_reason
            base["reason_code"] = kpi_reason_code(b0_reason)
            return base
        b0_so = sum(a["b0_stockout"] for a in avail.values())
        base["baseline_stockouts"] = b0_so
        base["stockout_reduction_pct"] = round((b0_so - ml_so) / b0_so * 100.0, 1) if b0_so else None

        def avg_inv(model) -> Optional[float]:
            sub = (
                db.query(func.sum(model.on_hand_end).label("s"))
                .filter(model.store_id.in_(stores), model.date >= start, model.date <= end)
                .group_by(model.date)
                .all()
            )
            return round(sum(float(x.s or 0.0) for x in sub) / len(sub), 1) if sub else None

        base["ml_avg_inventory"] = avg_inv(InventoryDaily)
        base["baseline_avg_inventory"] = avg_inv(SimShadowDaily)

        def holding(model) -> float:
            # G-37: end-of-day stock valued at the price of its day (price_history, else products.price)
            v = valued_stock_sums(db, model, stores, start, end, by=None).get(None, (0.0, 0.0))[0]
            return float(v or 0.0) * pc.HOLDING_RATE_DAILY

        base["holding_cost_savings"] = round(holding(SimShadowDaily) - holding(InventoryDaily), 2)
        return base

    # ------------------------------------------------------------------ UC42
    def get_cost_comparison_report(
        self,
        db: Session,
        store_id: Optional[str] = None,
        category: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        UC42: so sánh chi phí A3 giữa chính sách chạy (C³-OUT, inventory_daily + đơn đặt) và B0 shadow song song
        (sim_shadow_daily) trên cửa sổ đã mô phỏng: h*giá*tồn cuối ngày, b*giá*thiếu, c*đơn đã đặt.
        Không còn tỷ lệ mất bán 0.0595/0.0317 hay EOQ Wilson nhúng; chưa mô phỏng -> null + reason.
        """
        stores, start, end = self._sim_window(db, store_id)
        out: Dict[str, Any] = {
            "store_id": store_id or "All", "total_skus": 0, "baseline_policy": None, "ml_policy": None,
            "cost_savings_amount": None, "savings_percentage": None, "category_savings": {},
            "source": "simulator", "as_of": str(end) if end else None,
            "period_start": str(start) if start else None, "period_end": str(end) if end else None, "reason": None,
            "reason_code": None,
        }
        if not stores:
            out["reason"] = "Không có sim_clock cho phạm vi yêu cầu."
            out["reason_code"] = "no_clock"
            return out
        cat_filter = category.strip().upper() if category and category.strip() and category.upper() != "ALL" else None
        out["total_skus"] = db.query(func.count(Inventory.item_id)).filter(Inventory.store_id.in_(stores)).scalar() or 0

        from app.services.dashboard_service import valued_stock_sums

        def money(model) -> Dict[str, Tuple[float, float]]:
            # G-37: holding / lost valued at the price of each row's day (price_history, else products.price)
            return {
                c: (h * pc.HOLDING_RATE_DAILY, s * pc.STOCKOUT_PENALTY_RATE)
                for c, (h, s) in valued_stock_sums(db, model, stores, start, end, by="cat").items()
            }

        c3_money, b0_money = money(InventoryDaily), money(SimShadowDaily)
        if not c3_money:
            out["reason"] = "Chưa có inventory_daily trong cửa sổ mô phỏng (đồng hồ chưa tua)."
            out["reason_code"] = "no_simulated_days"
            return out
        c3_orders: Dict[str, float] = {}
        for c, n in (
            db.query(func.coalesce(Product.cat_id, "UNKNOWN"), func.count(ReplenishmentRecommendation.id))
            .join(Product, Product.item_id == ReplenishmentRecommendation.item_id)
            .filter(
                ReplenishmentRecommendation.store_id.in_(stores),
                ReplenishmentRecommendation.review_date >= start, ReplenishmentRecommendation.review_date <= end,
                ReplenishmentRecommendation.status.in_(("APPROVED", "COMPLETED")),
            )
            .group_by(func.coalesce(Product.cat_id, "UNKNOWN"))
            .all()
        ):
            c3_orders[str(c).upper()] = float(n) * pc.ORDER_COST_C
        b0_orders: Dict[str, float] = {}
        for c, n in (
            db.query(func.coalesce(Product.cat_id, "UNKNOWN"), func.count(SimShadowDaily.item_id))
            .join(Product, Product.item_id == SimShadowDaily.item_id)
            .filter(SimShadowDaily.store_id.in_(stores), SimShadowDaily.date >= start, SimShadowDaily.date <= end,
                    SimShadowDaily.order_qty > 0)
            .group_by(func.coalesce(Product.cat_id, "UNKNOWN"))
            .all()
        ):
            b0_orders[str(c).upper()] = float(n) * pc.ORDER_COST_C

        def detail(money_map, orders_map, cats) -> Dict[str, float]:
            h = sum(money_map.get(c, (0.0, 0.0))[0] for c in cats)
            s = sum(money_map.get(c, (0.0, 0.0))[1] for c in cats)
            o = sum(orders_map.get(c, 0.0) for c in cats)
            return {"holding_cost": round(h, 2), "order_cost": round(o, 2), "stockout_penalty_cost": round(s, 2),
                    "total_cost": round(h + o + s, 2)}

        all_cats = sorted(set(c3_money) | set(b0_money) | set(c3_orders) | set(b0_orders))
        cats = [cat_filter] if cat_filter else all_cats
        out["ml_policy"] = detail(c3_money, c3_orders, cats)
        if not b0_money:
            out["reason"] = "B0 shadow chưa được mô phỏng song song (reset đồng hồ và tua lại): chưa có đường cơ sở để so sánh."
            out["reason_code"] = "no_shadow"
            return out
        out["baseline_policy"] = detail(b0_money, b0_orders, cats)
        sav = round(out["baseline_policy"]["total_cost"] - out["ml_policy"]["total_cost"], 2)
        out["cost_savings_amount"] = sav
        out["savings_percentage"] = round(sav / out["baseline_policy"]["total_cost"] * 100.0, 1) if out["baseline_policy"]["total_cost"] else None
        out["category_savings"] = {
            c: round(detail(b0_money, b0_orders, [c])["total_cost"] - detail(c3_money, c3_orders, [c])["total_cost"], 2)
            for c in all_cats
        }
        return out


reports_repository = ReportsRepository()
