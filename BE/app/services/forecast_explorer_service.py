"""
G-49 - Forecast Explorer additions (teacher demo.md screen 2 and demo steps 4-5;
docs/teacher_map/A_docs_and_report.md sec. 5.9, 5.11).

GET /api/v1/forecast-explorer/window?store_id=&item_id=&review_date=  returns, for ONE SKU and review date:

(a) distribution of the total demand of the protection window H = L + R (route (c) window quantiles, the SAME
    record J4 reads: stored row if any - teacher import or earlier J3 - else computed on the fly, never written):
    lowest stored level, Q50, Q80, Q90, Q95, Q99 and the point forecast F_hat(H).

(b) window error statistics of the chosen model against simple baselines over a lookback before the review date.
    Unit = one H-day window total at an origin o (the quantity the policy actually uses):
        model     F_hat_o(H): forecast_backtest.dhat * H / BACKTEST_WINDOW_DAYS (causal backtest Ensemble) or,
                  when the SKU has no backtest row, the point_window of stored window-quantile rows at o
        SNaive    sum_{h=0..H-1} y[o - 7 + (h mod 7)]   (weekly seasonal naive, only days < o)
        Naive     H * y[o - 1]
        MA28      H * mean(y[o-28 .. o-1])
    A window is scored only when its H actual days are all known (missing day is never 0), the window ends on or
    before the review date (o + H <= review_date: no future data) and every method has a value.
        MASE  = mean |F - A| / (H * mean |y_t - y_{t-7}|), scale over the 364 days before the first scored origin
        bias  = mean (F - A)  (positive = over-forecast); bias_pct = sum(F - A) / sum(A)
    Holt-Winters / LightGBM single-model baselines (teacher table) are NOT stored in the app: not reported.

(c) s / S implied by the CURRENT class parameters (teacher REFIT-RSS-EOQ-G, same formula as J4):
        s   = ceil(Q_hat(tau) * exp(m_g + theta_g) - 1e-9)
        EOQ = sqrt(2 c mu / (h p)),  mu = mean actual daily sales of the 56 days before the review date
        S   = s + ceil(kappa_g * EOQ - 1e-9)
    with (m_g, kappa_g) from policy_selection (J5) and theta_g the latest C3-OUT state on or before the review date.
    The stored inventory_params s / S (last J4 run) is returned next to it for comparison.

Read-only: nothing here writes to the database.
"""
from __future__ import annotations

import math
import warnings
from datetime import date
from typing import Dict, List, Optional

import numpy as np
from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session

from app.models.classification import SKUClassification
from app.models.forecast_backtest import ForecastBacktest
from app.models.forecast_window_quantile import ForecastWindowQuantile
from app.models.inventory_param import InventoryParam
from app.models.product import Product
from app.models.sim_clock import SimClock
from app.services import policy_backtest
from app.services import policy_config as pc
from app.services.window_quantile_service import (
    DEFAULT_MODEL_RUN_ID,
    WindowQuantileService,
    build_actuals_matrix,
    window_quantile_service,
)

BOX_LEVELS = (0.5, 0.8, 0.9, 0.95, 0.99)
DEFAULT_LOOKBACK_DAYS = 182
SCALE_HISTORY_DAYS = 364
MA_DAYS = 28
SEASON = 7


class WindowDistribution(BaseModel):
    model_run_id: str
    route: str
    stored: bool
    point_source: Optional[str] = None
    n_residuals: Optional[int] = None
    point_window: float
    min_level: Optional[float] = None
    q_min: Optional[float] = None
    q50: Optional[float] = None
    q80: Optional[float] = None
    q90: Optional[float] = None
    q95: Optional[float] = None
    q99: Optional[float] = None
    q_levels: Dict[str, float]


class MethodError(BaseModel):
    method: str
    n_windows: int
    mae: Optional[float] = None
    mase: Optional[float] = None
    bias: Optional[float] = None
    bias_pct: Optional[float] = None


class ErrorStats(BaseModel):
    lookback_days: int
    unit: str
    model_source: Optional[str] = None
    n_windows: int
    first_origin: Optional[date] = None
    last_origin: Optional[date] = None
    scale: Optional[float] = None
    scale_days: int
    methods: List[MethodError]
    reason_code: Optional[str] = None


class ImpliedPolicy(BaseModel):
    segment: Optional[str] = None
    class_source: Optional[str] = None
    tau: float
    q_hat_tau: float
    m_g: float
    kappa_g: float
    theta_g: float
    policy_selection_id: Optional[str] = None
    policy_source: Optional[str] = None
    mean_daily_56: Optional[float] = None
    eoq: float
    s: float
    S: float
    price: float
    stored_s: Optional[float] = None
    stored_S: Optional[float] = None
    stored_model_run_id: Optional[str] = None


class ForecastWindowExplorerResponse(BaseModel):
    store_id: str
    item_id: str
    review_date: date
    review_date_source: str  # "request" | "sim_clock" | "demo_default"
    lead_time_days: int
    review_period_days: int
    horizon_days: int
    distribution: WindowDistribution
    error_stats: ErrorStats
    policy: ImpliedPolicy
    notes: List[str]


def _q(levels: Dict[str, float], tau: float, point: float) -> Optional[float]:
    if not levels:
        return None
    return round(WindowQuantileService.tau_value(levels, tau, point), 4)


def window_error_stats(
    actual_daily: np.ndarray, first_day_idx: int, origins: List[int], model: Dict[int, float], H: int,
    review_idx: int, lookback_days: int,
) -> ErrorStats:
    """Pure core of (b). ``actual_daily[k]`` is the demand of M5 day ``first_day_idx + k`` (NaN = unknown)."""
    y = np.asarray(actual_daily, dtype=float)

    def day(i: int) -> float:
        k = i - first_day_idx
        return float(y[k]) if 0 <= k < len(y) else float("nan")

    rows = []  # (origin, actual, model, snaive, naive, ma)
    for o in sorted(set(origins)):
        if o + H > review_idx or o < review_idx - lookback_days or o not in model:
            continue
        act = [day(o + h) for h in range(H)]
        if any(math.isnan(v) for v in act):
            continue
        sn = [day(o - SEASON + (h % SEASON)) for h in range(H)]
        last = day(o - 1)
        ma_vals = [day(o - k) for k in range(1, MA_DAYS + 1)]
        ma_known = [v for v in ma_vals if not math.isnan(v)]
        if any(math.isnan(v) for v in sn) or math.isnan(last) or not ma_known:
            continue
        rows.append((o, sum(act), float(model[o]), sum(sn), H * last, H * float(np.mean(ma_known))))

    scale = None
    if rows:
        first = rows[0][0]
        hist = [day(i) for i in range(first - SCALE_HISTORY_DAYS, first)]
        diffs = [abs(hist[i] - hist[i - SEASON]) for i in range(SEASON, len(hist))
                 if not math.isnan(hist[i]) and not math.isnan(hist[i - SEASON])]
        if len(diffs) >= SEASON and float(np.mean(diffs)) > 0:
            scale = H * float(np.mean(diffs))

    methods: List[MethodError] = []
    for name, col in (("model", 2), ("snaive", 3), ("naive", 4), ("ma28", 5)):
        if not rows:
            methods.append(MethodError(method=name, n_windows=0))
            continue
        a = np.array([r[1] for r in rows])
        f = np.array([r[col] for r in rows])
        err = f - a
        mae = float(np.mean(np.abs(err)))
        methods.append(MethodError(
            method=name, n_windows=len(rows), mae=round(mae, 4),
            mase=round(mae / scale, 4) if scale else None,
            bias=round(float(np.mean(err)), 4),
            bias_pct=round(float(err.sum() / a.sum()), 4) if a.sum() > 0 else None,
        ))
    reason = None
    if not model:
        reason = "no_model_windows"
    elif not rows:
        reason = "no_complete_windows"
    elif scale is None:
        reason = "no_mase_scale"
    return ErrorStats(
        lookback_days=lookback_days, unit=f"window_total_H{H}", n_windows=len(rows),
        first_origin=pc.day_index_to_date(rows[0][0]) if rows else None,
        last_origin=pc.day_index_to_date(rows[-1][0]) if rows else None,
        scale=round(scale, 4) if scale else None, scale_days=SCALE_HISTORY_DAYS, methods=methods,
        reason_code=reason,
    )


class ForecastExplorerService:

    @staticmethod
    def _lead_time(db: Session, prod: Product) -> int:
        from app.services.optimization_service import optimization_service as opt  # read-only helpers
        if opt._use_supplier_lead_time(db):
            return int(opt._supplier_lt_map(db).get((prod.cat_id or "").upper(), pc.LEAD_TIME_DAYS))
        return pc.LEAD_TIME_DAYS

    @staticmethod
    def _model_windows(db: Session, store_id: str, item_id: str, H: int, lo_idx: int, hi_idx: int):
        scale = H / float(pc.BACKTEST_WINDOW_DAYS)
        bt = (
            db.query(ForecastBacktest.review_day, ForecastBacktest.dhat)
            .filter(ForecastBacktest.store_id == store_id, ForecastBacktest.item_id == item_id,
                    ForecastBacktest.review_day >= lo_idx, ForecastBacktest.review_day <= hi_idx)
            .all()
        )
        if bt:
            return {int(r): float(d) * scale for r, d in bt}, "forecast_backtest"
        stored = (
            db.query(ForecastWindowQuantile.origin_date, ForecastWindowQuantile.point_window)
            .filter(ForecastWindowQuantile.store_id == store_id, ForecastWindowQuantile.item_id == item_id,
                    ForecastWindowQuantile.horizon_days == H,
                    ForecastWindowQuantile.origin_date >= pc.day_index_to_date(lo_idx),
                    ForecastWindowQuantile.origin_date <= pc.day_index_to_date(hi_idx))
            .all()
        )
        if stored:
            return {pc.date_to_day_index(o): float(p) for o, p in stored}, "forecast_window_quantile"
        return {}, None

    def window(
        self,
        db: Session,
        store_id: Optional[str],
        item_id: str,
        review_date: Optional[date] = None,
        lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    ) -> ForecastWindowExplorerResponse:
        sid = (store_id or "").strip()
        if not sid or sid.upper() in ("GLOBAL", "ALL"):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                                detail="Forecast Explorer cần một cửa hàng cụ thể (store_id khác GLOBAL/ALL).")
        prod = db.query(Product).filter(Product.item_id == item_id).first()
        if not prod:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail=f"Không tìm thấy SKU sản phẩm '{item_id}'.")

        clock = db.query(SimClock).filter(SimClock.store_id == sid).first()
        clock_date = clock.current_date if clock and clock.current_date else None
        if review_date is not None:
            if clock_date is not None and review_date > clock_date:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"review_date {review_date} nằm sau ngày đồng hồ mô phỏng {clock_date}: dữ liệu tương lai.",
                )
            o_date, o_src = review_date, "request"
        elif clock_date is not None:
            o_date, o_src = clock_date, "sim_clock"
        else:
            o_date, o_src = pc.DEMO_START_DATE, "demo_default"

        L = self._lead_time(db, prod)
        R = pc.REVIEW_PERIOD_DAYS
        H = L + R
        o_idx = pc.date_to_day_index(o_date)

        # (a) the window distribution J4 reads (stored if present, else computed; persist=False -> no write)
        rec = window_quantile_service.get_or_create_window_quantile(
            db, store_id=sid, item_id=item_id, origin_date=o_date, horizon_days=H, persist=False)
        stored = bool(sa_inspect(rec).persistent)
        point_source = n_res = None
        if not stored:
            w = window_quantile_service._compute_items(db, sid, [item_id], o_date, H)[item_id]
            point_source, n_res = w.point_source, int(len(w.residuals))
        levels = {str(k): float(v) for k, v in (rec.q_levels or {}).items()}
        numeric = sorted((float(k), v) for k, v in levels.items() if _is_float(k))
        point = float(rec.point_window or 0.0)
        dist = WindowDistribution(
            model_run_id=rec.model_run_id or DEFAULT_MODEL_RUN_ID, route=rec.route or pc.ROUTE_EMPIRICAL,
            stored=stored, point_source=point_source, n_residuals=n_res, point_window=round(point, 4),
            min_level=numeric[0][0] if numeric else None, q_min=round(numeric[0][1], 4) if numeric else None,
            q50=_q(levels, 0.5, point), q80=_q(levels, 0.8, point), q90=_q(levels, 0.9, point),
            q95=_q(levels, 0.95, point), q99=_q(levels, 0.99, point), q_levels=levels,
        )

        # (b) error statistics over the lookback
        lo = o_idx - lookback_days
        model, model_src = self._model_windows(db, sid, item_id, H, lo, o_idx - H)
        first_day = lo - SCALE_HISTORY_DAYS - MA_DAYS
        A = build_actuals_matrix(db, sid, [item_id], max(0, first_day), o_idx)
        stats = window_error_stats(A[0] if A.shape[0] else np.array([]), max(0, first_day), list(model.keys()),
                                   model, H, o_idx, lookback_days)
        stats.model_source = model_src

        # (c) s / S implied by the current class parameters
        from app.services.calibrator_service import calibrator_service
        from app.services.optimization_service import optimization_service as opt
        cls = (db.query(SKUClassification)
               .filter(SKUClassification.item_id == item_id, SKUClassification.store_id == sid).first())
        segment = cls.segment if cls else None
        pol = calibrator_service.resolve_policies(db, sid).get(segment or "AX")
        m_g = float(pol.m_g) if pol and pol.m_g is not None else 0.0
        kappa = float(pol.kappa_g) if pol and pol.kappa_g is not None else 1.0
        theta = float(calibrator_service.get_current_thetas(db, sid, as_of=o_date).get(segment or "AX", 0.0))
        tau = float(opt._resolve_service_level(opt.get_service_level_config(db), item_id, prod.cat_id))
        q_tau = WindowQuantileService.tau_value(levels, tau, point) if levels else max(0.0, point)
        s_val = float(math.ceil(q_tau * math.exp(m_g + theta) - policy_backtest.CEIL_EPS))
        A56 = build_actuals_matrix(db, sid, [item_id], max(0, o_idx - pc.EOQ_MEAN_WINDOW_DAYS), o_idx)
        with np.errstate(all="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            mu = float(np.nanmean(A56[0])) if A56.size else float("nan")
        mu_known = not math.isnan(mu)
        # G-37: the price of the review day (price_history, else products.price), as J4 used for the stored s / S
        from app.repositories import price_history_repository
        base_price = float(prod.price) if prod.price and float(prod.price) > 0 else 10.0
        price = float(price_history_repository.price_map_on(
            db, sid, [item_id], o_date, fallback={item_id: base_price}).get(item_id, base_price))
        eoq = float(opt.teacher_eoq(np.array([mu if mu_known else 0.0]), np.array([price]))[0])
        S_val = float(s_val + math.ceil(kappa * eoq - policy_backtest.CEIL_EPS))
        ip_row = (db.query(InventoryParam)
                  .filter(InventoryParam.item_id == item_id, InventoryParam.store_id == sid).first())
        policy = ImpliedPolicy(
            segment=segment, class_source=cls.class_source if cls else None, tau=tau, q_hat_tau=round(q_tau, 4),
            m_g=m_g, kappa_g=kappa, theta_g=theta,
            policy_selection_id=pol.selection_id if pol else None, policy_source=pol.source if pol else None,
            mean_daily_56=round(mu, 4) if mu_known else None, eoq=round(eoq, 4), s=s_val, S=S_val, price=price,
            stored_s=float(ip_row.s) if ip_row and ip_row.s is not None else None,
            stored_S=float(ip_row.S) if ip_row and ip_row.S is not None else None,
            stored_model_run_id=ip_row.model_run_id if ip_row else None,
        )

        notes = [
            "Daily quantiles are not added up: the window quantile comes from the empirical distribution of H-day "
            "window errors (route c), because the sum of daily Q(0.95) overstates the 0.95 quantile of the sum.",
            "Holt-Winters and single LightGBM baselines of the teacher's table are not stored in the app; the "
            "baselines here are computed from sales_history (SNaive, Naive, MA28).",
        ]
        if segment is None:
            notes.append("SKU has no ABC-XYZ class in this store: class AX parameters are used, as J4 does.")
        if pol is None:
            notes.append("No policy_selection row (J5 not run): neutral m_g = 0, kappa_g = 1.")
        if not mu_known:
            notes.append("No sales in the 56 days before the review date: EOQ = 0.")
        return ForecastWindowExplorerResponse(
            store_id=sid, item_id=item_id, review_date=o_date, review_date_source=o_src,
            lead_time_days=L, review_period_days=R, horizon_days=H,
            distribution=dist, error_stats=stats, policy=policy, notes=notes,
        )


def _is_float(x: str) -> bool:
    try:
        float(x)
        return True
    except (TypeError, ValueError):
        return False


forecast_explorer_service = ForecastExplorerService()
