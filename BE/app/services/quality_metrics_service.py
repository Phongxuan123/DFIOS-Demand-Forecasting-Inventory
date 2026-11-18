"""
Quality metrics (G-30 forecast quality, G-19 / G-21 controller monitoring), pure numpy cores + thin DB readers.

1. Forecast quality of the (L+R)-window quantiles, teacher E3 (``DFIOS/experiments/e2_e3_accuracy_coverage.py``,
   ``e3`` / ``scales``; docs/teacher_map/A_docs_and_report.md sec. 3.3). For window quantiles Q[origin, sku, level]
   and realised window totals Y[origin, sku] = sum of y over days [o, o+H):

   * coverage(tau)  = share of (origin, sku) windows with Y <= Q(tau) + 1e-9, tau in {0.5, 0.8, 0.9, 0.95, 0.99}
                      (the teacher's E3 set);
   * SPL            = mean over SKUs with a finite scale of [ mean_{origins, stored levels} pinball_tau(Y, Q) / (H*s1) ],
                      pinball_tau(y, q) = max(tau*(y-q), (tau-1)*(y-q)), averaged over ALL stored levels (19 levels
                      0.50..0.999 for the teacher's grid);
   * s1 (per SKU)   = mean |y_t - y_{t-1}| over the history before ``scale_end`` starting at the first sale (M5
                      one-step convention); s1 <= 0 or no sale -> NaN (SKU excluded from SPL / MASE only);
   * MASE (median)  = mean over SKUs with finite s1 of [ mean_origins |Q(0.5) - Y| / (H*s1) ];
   * median bias %  = 100 * (sum Q(0.5) / sum Y - 1).
   The teacher scales use history before VAL_START = day 1395 and test origins o >= 1577 with o + H <= 1941.
   Missing actuals (NaN) are never 0: a window with a missing day is dropped (teacher data has none).

2. Controller monitoring (``c3out_experiments/c3out/revision.py``: ``service_metrics`` and ``recovery``), on the
   per-class stock-out shares e[cycle, class] of COMPLETE service cycles (J6 ``service_outcomes``):

   * class availability A_g = 1 - mean_k e[k, g]; target 0.95 (the service commitment);
   * rolling window = 4 consecutive complete cycles, rolling availability = 1 - mean of the 4 shares;
     violation(window, g) = max(0.95 - rolling availability, 0); a ROLLING VIOLATION is violation > 0.01
     (more than one percentage point below 0.95); ``rolling_violation`` = share of (window, class) pairs violating;
   * recovery after an event day: the first 3 consecutive rolling windows whose first review day is >= the event
     day and whose mean over classes of |rolling availability - 0.95| is <= 0.02; recovery days = last day of the
     last cycle of the third window + 1 - event day; NaN (None in JSON) when never observed (censored, never 0);
   * status per class from ``calibration_state`` (latest row k): Warm-up (no row, or no J6 outcome for cycle k - d,
     d = ceil((L+R)/R), i.e. no matured error consumed yet),
     Boundary (theta at the upper limit 2), else Active.
"""
from __future__ import annotations

import math
from datetime import date
from typing import Any, Dict, List, Optional, Sequence

import numpy as np
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.forecast_window_quantile import ForecastWindowQuantile
from app.models.service_outcomes import ServiceOutcome
from app.models.sim_clock import SimClock
from app.services import policy_config as pc

# Teacher's 19 stored levels (c3out/quantiles.py LEVELS) and the E3 coverage set.
TEACHER_LEVELS: List[float] = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.925, 0.95, 0.96, 0.97, 0.975,
                               0.98, 0.985, 0.99, 0.995, 0.999]
COVERAGE_TAUS: List[float] = [0.5, 0.8, 0.9, 0.95, 0.99]
VAL_START_IDX = 1395

SERVICE_TARGET = 0.95
ROLLING_WINDOW = 4
VIOLATION_TOL = 0.01
RECOVERY_TOL = 0.02
RECOVERY_SUSTAINED = 3


def _f(x: Any) -> Optional[float]:
    """float, NaN/inf -> None (JSON)."""
    if x is None:
        return None
    x = float(x)
    return x if math.isfinite(x) else None


# ------------------------------------------------------------------------------------------------------------
# 1. Forecast quality: pure numpy
# ------------------------------------------------------------------------------------------------------------
def scales_s1(y: np.ndarray, end: int) -> np.ndarray:
    """Per-SKU one-step scale s1 on y[:, :end]: mean |diff| from the first sale (teacher ``scales``). NaN-aware:
    missing diffs are skipped. s1 <= 0, no sale or no diff -> NaN."""
    h = np.asarray(y[:, :end], dtype=float)
    n = h.shape[0]
    if h.shape[1] < 2:
        return np.full(n, np.nan)
    pos = np.nan_to_num(h, nan=0.0) > 0
    has = pos.any(1)
    first = np.argmax(pos, 1)
    d = np.abs(np.diff(h, axis=1))  # d[:, k] = |y[k+1] - y[k]|
    mask = (np.arange(d.shape[1])[None, :] >= first[:, None]) & np.isfinite(d)
    cnt = mask.sum(1)
    with np.errstate(invalid="ignore", divide="ignore"):
        s1 = np.where(mask, d, 0.0).sum(1) / cnt
    s1 = np.where(has & (cnt > 0) & (s1 > 0), s1, np.nan)
    return s1


def compute_forecast_quality(
    y: np.ndarray,
    Q: np.ndarray,
    levels: Sequence[float],
    origins: Sequence[int],
    H: int,
    scale: Optional[np.ndarray] = None,
    rows: Optional[Sequence[int]] = None,
    coverage_taus: Sequence[float] = COVERAGE_TAUS,
    chunk: int = 16,
) -> Dict[str, Any]:
    """
    Window forecast quality (teacher E3 formulas).

    y        [n_sku, T] daily actuals, column t = day t (NaN = unknown day);
    Q        [n_origin, n_sku, n_level] window quantiles, Q[k] belongs to origins[k] (may be a numpy memmap);
    levels   the n_level stored levels (SPL averages over all of them);
    origins  day index of each Q row; the window of origin o is days [o, o+H);
    scale    per-SKU s1 (NaN = no scale); None -> ``scales_s1(y, min(evaluated origins))``;
    rows     optional subset of Q rows to evaluate (default: all). Rows whose window leaves y are skipped.
    Memory is bounded: Q is read ``chunk`` origins at a time.
    """
    lv = np.asarray(levels, dtype=float)
    origins = np.asarray(origins, dtype=int)
    n, T = y.shape
    rows = np.arange(len(origins)) if rows is None else np.asarray(rows, dtype=int)
    rows = rows[(origins[rows] >= 0) & (origins[rows] + H <= T)]
    if scale is None:
        scale = scales_s1(y, int(origins[rows].min()) if len(rows) else 0)
    s1 = np.asarray(scale, dtype=float)
    i_med = int(np.argmin(np.abs(lv - 0.5)))
    cov_idx = {t: int(np.argmin(np.abs(lv - t))) for t in coverage_taus if np.min(np.abs(lv - t)) < 1e-9}

    pin_sum = np.zeros(n)        # per SKU: sum over (origin, level) of pinball
    ae_sum = np.zeros(n)         # per SKU: sum over origins of |median - Y|
    win_cnt = np.zeros(n)        # per SKU: number of valid windows
    cov_hit = {t: 0 for t in cov_idx}
    n_win = 0
    med_total = y_total = 0.0
    yc = np.asarray(y, dtype=float)
    for a in range(0, len(rows), chunk):
        rr = rows[a:a + chunk]
        Yw = np.stack([yc[:, o:o + H].sum(1) for o in origins[rr]])          # [o, n], NaN if any day missing
        Qc = np.asarray(Q[rr], dtype=float)                                   # [o, n, lev]
        ok = np.isfinite(Yw) & np.isfinite(Qc).all(-1)
        Yz = np.where(ok, Yw, 0.0)
        Qz = np.where(ok[..., None], Qc, 0.0)
        u = Yz[..., None] - Qz
        pin = np.maximum(lv * u, (lv - 1) * u).sum(-1)                        # [o, n]
        pin_sum += np.where(ok, pin, 0.0).sum(0)
        med = Qz[..., i_med]
        ae_sum += np.where(ok, np.abs(med - Yz), 0.0).sum(0)
        win_cnt += ok.sum(0)
        n_win += int(ok.sum())
        med_total += float(med[ok].sum())
        y_total += float(Yz[ok].sum())
        for t, j in cov_idx.items():
            cov_hit[t] += int(((Yz <= Qz[..., j] + 1e-9) & ok).sum())

    good = np.isfinite(s1) & (win_cnt > 0)
    with np.errstate(invalid="ignore", divide="ignore"):
        spl_sku = pin_sum / (win_cnt * len(lv)) / (H * s1)
        mase_sku = ae_sum / win_cnt / (H * s1)
    used = origins[rows]
    return dict(
        horizon_days=int(H),
        n_levels=int(len(lv)),
        levels=[float(x) for x in lv],
        n_origins=int(len(rows)),
        first_origin=int(used.min()) if len(used) else None,
        last_origin=int(used.max()) if len(used) else None,
        n_sku=int(n),
        n_sku_scaled=int(good.sum()),
        n_windows=int(n_win),
        coverage={str(t): (_f(cov_hit[t] / n_win) if n_win else None) for t in cov_idx},
        spl=_f(spl_sku[good].mean()) if good.any() else None,
        mase_median=_f(mase_sku[good].mean()) if good.any() else None,
        median_bias_pct=_f(100.0 * (med_total / y_total - 1.0)) if y_total > 0 else None,
    )


# ------------------------------------------------------------------------------------------------------------
# 2. Controller monitoring: pure numpy
# ------------------------------------------------------------------------------------------------------------
def rolling_availability(errors: np.ndarray, window: int = ROLLING_WINDOW) -> np.ndarray:
    """errors [cycle, class] -> rolling availability [n_cycle - window + 1, class] (NaN if any share missing)."""
    e = np.asarray(errors, dtype=float)
    if e.shape[0] < window:
        return np.empty((0, e.shape[1]))
    return 1.0 - np.lib.stride_tricks.sliding_window_view(e, window, axis=0).mean(-1)


def service_metrics(errors: np.ndarray, target: float = SERVICE_TARGET, window: int = ROLLING_WINDOW,
                    tol: float = VIOLATION_TOL) -> Dict[str, Any]:
    """Teacher ``revision.service_metrics`` on errors [complete cycle, class] (unweighted class means), plus the
    per-class rolling-violation shares. NaN cells (class without SKUs in a cycle) are ignored."""
    e = np.asarray(errors, dtype=float)
    G = e.shape[1]
    with np.errstate(invalid="ignore"):
        csl = 1.0 - np.nanmean(e, 0) if len(e) else np.full(G, np.nan)
    delta = csl - target
    roll = rolling_availability(e, window)
    if len(roll):
        viol = np.maximum(target - roll, 0.0)
        viol = np.where(np.isfinite(roll), viol, np.nan)
        flag = np.where(np.isfinite(viol), (viol > tol).astype(float), np.nan)
        roll_gap = np.abs(roll - target)
    else:
        viol = flag = roll_gap = np.full((1, G), np.nan)
    with np.errstate(invalid="ignore"):
        fin = np.isfinite(csl)
        return dict(
            n_cycles=int(len(e)),
            n_windows=int(len(roll)),
            gap_mean=_f(np.nanmean(np.abs(delta))) if fin.any() else None,
            signed_gap=_f(np.nanmean(delta)) if fin.any() else None,
            min_class_csl=_f(np.nanmin(csl)) if fin.any() else None,
            feasible=bool((csl[fin] >= target - 1e-12).all()) if fin.any() else None,
            feasible_1pp=bool((csl[fin] >= target - tol - 1e-12).all()) if fin.any() else None,
            rolling_gap=_f(np.nanmean(roll_gap)) if np.isfinite(roll_gap).any() else None,
            rolling_shortfall=_f(np.nanmean(viol)) if np.isfinite(viol).any() else None,
            rolling_violation=_f(np.nanmean(flag)) if np.isfinite(flag).any() else None,
            rolling_worst=_f(np.nanmax(viol)) if np.isfinite(viol).any() else None,
            class_csl=[_f(c) for c in csl],
            class_rolling_violation=[_f(np.nanmean(flag[:, g])) if np.isfinite(flag[:, g]).any() else None
                                     for g in range(G)],
            class_violating_windows=[int(np.nansum(flag[:, g])) for g in range(G)],
            class_last_rolling=[_f(roll[-1, g]) if len(roll) else None for g in range(G)],
        )


def recovery_days(review_days: Sequence[int], cycle_ends: Sequence[int], errors: np.ndarray, event_day: int,
                  target: float = SERVICE_TARGET, tolerance: float = RECOVERY_TOL, window: int = ROLLING_WINDOW,
                  sustained: int = RECOVERY_SUSTAINED) -> float:
    """Teacher ``revision.recovery`` on complete cycles: review_days / cycle_ends (inclusive last day) / errors
    [cycle, class] are aligned. Returns days, or NaN when no recovery is observed (censored, never 0)."""
    e = np.asarray(errors, dtype=float)
    days = np.asarray(review_days, dtype=int)
    ends = np.asarray(cycle_ends, dtype=int)
    if len(e) < window + sustained - 1:
        return float("nan")
    roll = rolling_availability(e, window)
    with np.errstate(invalid="ignore"):
        gap = np.nanmean(np.abs(roll - target), 1)
    good = np.where(np.isfinite(gap), gap <= tolerance, False)
    eligible = days[:len(good)] >= event_day
    for j in range(len(good) - sustained + 1):
        if eligible[j] and good[j:j + sustained].all():
            return float(ends[j + window + sustained - 2] + 1 - event_day)
    return float("nan")


# ------------------------------------------------------------------------------------------------------------
# DB readers
# ------------------------------------------------------------------------------------------------------------
def _spread(values: Sequence, k: int) -> list:
    """k evenly spaced elements of a sorted list (all when k >= len)."""
    values = list(values)
    if k <= 0 or len(values) <= k:
        return values
    idx = np.unique(np.round(np.linspace(0, len(values) - 1, k)).astype(int))
    return [values[i] for i in idx]


def forecast_quality_from_db(
    db: Session,
    store_id: str,
    horizon_days: int = pc.HORIZON_DAYS,
    model_run_id: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    max_origins: int = 60,
    max_items: int = 500,
    scale_end_date: Optional[date] = None,
) -> Dict[str, Any]:
    """Forecast quality of the stored window quantiles of a store against realised demand (sales_history / M5 CSV).
    Caps: at most ``max_origins`` evenly spaced complete origins and ``max_items`` evenly spaced SKUs."""
    from app.services.window_quantile_service import build_actuals_matrix

    H = int(horizon_days)
    base = db.query(ForecastWindowQuantile).filter(ForecastWindowQuantile.store_id == store_id,
                                                   ForecastWindowQuantile.horizon_days == H)
    if model_run_id is None:
        top = (db.query(ForecastWindowQuantile.model_run_id, func.count(ForecastWindowQuantile.id))
               .filter(ForecastWindowQuantile.store_id == store_id, ForecastWindowQuantile.horizon_days == H)
               .group_by(ForecastWindowQuantile.model_run_id)
               .order_by(func.count(ForecastWindowQuantile.id).desc()).first())
        model_run_id = top[0] if top else None
    out: Dict[str, Any] = dict(store_id=store_id, model_run_id=model_run_id, horizon_days=H)
    if model_run_id is None:
        return {**out, "status": "no_data", "detail": "no window quantiles for this store / horizon"}
    base = base.filter(ForecastWindowQuantile.model_run_id == model_run_id)

    oq = db.query(ForecastWindowQuantile.origin_date).filter(
        ForecastWindowQuantile.store_id == store_id, ForecastWindowQuantile.horizon_days == H,
        ForecastWindowQuantile.model_run_id == model_run_id)
    if start_date:
        oq = oq.filter(ForecastWindowQuantile.origin_date >= start_date)
    if end_date:
        oq = oq.filter(ForecastWindowQuantile.origin_date <= end_date)
    all_origins = sorted({r[0] for r in oq.distinct().all()})
    iq = db.query(ForecastWindowQuantile.item_id).filter(
        ForecastWindowQuantile.store_id == store_id, ForecastWindowQuantile.horizon_days == H,
        ForecastWindowQuantile.model_run_id == model_run_id).distinct()
    all_items = sorted({r[0] for r in iq.all()})
    if not all_origins or not all_items:
        return {**out, "status": "no_data", "detail": "no window quantiles in the requested range"}
    items = _spread(all_items, max_items)
    pos = {iid: i for i, iid in enumerate(items)}

    o_idx_all = [pc.date_to_day_index(d) for d in all_origins]
    first_o = min(o_idx_all)
    # realised demand from day 0 (scale history) to the last window end
    last_end = max(o_idx_all) + H
    A = build_actuals_matrix(db, store_id, items, 0, last_end)
    if scale_end_date is not None:
        scale_end = min(pc.date_to_day_index(scale_end_date), first_o)
    elif first_o > VAL_START_IDX and np.isfinite(A[:, :VAL_START_IDX]).any():
        scale_end = VAL_START_IDX  # teacher E3: scales from history before VAL_START only
    else:
        scale_end = first_o        # otherwise: all history strictly before the first origin (causal)
    # complete origins only: every day of the window known for at least one SKU (per-SKU NaN handled in the core)
    complete = [d for d, o in zip(all_origins, o_idx_all) if np.isfinite(A[:, o:o + H]).all(1).any()]
    origins_sel = _spread(complete, max_origins)
    if not origins_sel:
        return {**out, "status": "no_complete_window", "n_origins_total": len(all_origins),
                "detail": "no origin whose H-day window is fully observed yet"}

    # levels: the teacher's 19 when every row stores them, else the levels common to all rows
    common: Optional[set] = None
    # one query per SKU chunk for ALL selected origins (was one per origin and chunk): same rows, same parsing
    per_origin: Dict[date, Dict[int, dict]] = {d: {} for d in origins_sel}
    for k in range(0, len(items), 900):
        chunk = items[k:k + 900]
        for iid, od, ql in (base.with_entities(ForecastWindowQuantile.item_id, ForecastWindowQuantile.origin_date,
                                               ForecastWindowQuantile.q_levels)
                            .filter(ForecastWindowQuantile.origin_date.in_(origins_sel),
                                    ForecastWindowQuantile.item_id.in_(chunk)).all()):
            qd = {}
            for kk, v in (ql or {}).items():
                try:
                    qd[round(float(kk), 4)] = float(v)
                except (TypeError, ValueError):
                    continue
            per_origin[od][pos[iid]] = qd
            keys = set(qd)
            common = keys if common is None else (common & keys)
    raw: List[Dict[int, dict]] = [per_origin[d] for d in origins_sel]
    common = common or set()
    teacher = [lv for lv in TEACHER_LEVELS if lv in common]
    levels = teacher if len(teacher) == len(TEACHER_LEVELS) else sorted(common)
    if not levels:
        return {**out, "status": "no_levels", "detail": "stored rows share no quantile level"}
    Q = np.full((len(origins_sel), len(items), len(levels)), np.nan)
    for k, per in enumerate(raw):
        for i, qd in per.items():
            Q[k, i] = [qd[lv] for lv in levels]

    s1 = scales_s1(A, scale_end)
    origins = np.array([pc.date_to_day_index(d) for d in origins_sel])
    res = compute_forecast_quality(A, Q, levels, origins, H, s1)
    return {
        **out, "status": "ok",
        "levels_source": "teacher_19" if levels == TEACHER_LEVELS else "stored_common",
        "n_origins_total": len(all_origins), "n_origins_complete": len(complete),
        "origin_selection": "all" if len(origins_sel) == len(complete) else f"evenly spaced {len(origins_sel)}",
        "first_origin_date": origins_sel[0].isoformat(), "last_origin_date": origins_sel[-1].isoformat(),
        "n_items_total": len(all_items), "n_items_used": len(items),
        "scale_history_end_date": pc.day_index_to_date(scale_end).isoformat(),
        **{k: v for k, v in res.items() if k not in ("first_origin", "last_origin")},
    }


def controller_metrics_from_db(
    db: Session,
    store_id: str,
    event_date: Optional[date] = None,
    lead_time_days: int = pc.LEAD_TIME_DAYS,
    target: float = SERVICE_TARGET,
) -> Dict[str, Any]:
    """Rolling violation / recovery / status per class and overall from service_outcomes + calibration_state."""
    from app.services.calibrator_service import calibrator_service

    q = db.query(ServiceOutcome).filter(ServiceOutcome.store_id == store_id)
    clock = db.query(SimClock).filter(SimClock.store_id == store_id).first()
    if clock is not None and clock.current_date is not None:
        q = q.filter(ServiceOutcome.cycle_end <= clock.current_date)  # complete cycles only
    rows = q.order_by(ServiceOutcome.cycle_index, ServiceOutcome.class_id).all()

    classes_all = list(pc.ALL_CLASSES)
    n_sku_of: Dict[str, int] = {}
    cyc: Dict[int, Dict[str, Any]] = {}
    for r in rows:
        if r.class_id not in classes_all:
            continue
        c = cyc.setdefault(int(r.cycle_index), {"start": r.cycle_start, "end": r.cycle_end, "e": {}})
        if (r.n_sku or 0) > 0:
            c["e"][r.class_id] = float(r.n_stockout or 0) / float(r.n_sku) if r.error_rate is None \
                else float(r.error_rate)
            n_sku_of[r.class_id] = max(n_sku_of.get(r.class_id, 0), int(r.n_sku))
    classes = [c for c in classes_all if c in n_sku_of]  # classes with SKUs (teacher groups have members)

    # status from the latest calibration state
    latest = calibrator_service.latest_states(db, store_id)
    d = math.ceil((int(lead_time_days) + pc.REVIEW_PERIOD_DAYS) / float(pc.REVIEW_PERIOD_DAYS))
    matured: Dict[str, set] = {}
    for cl, k in db.query(ServiceOutcome.class_id, ServiceOutcome.cycle_index).filter(
            ServiceOutcome.store_id == store_id).all():
        matured.setdefault(cl, set()).add(int(k))
    status: Dict[str, Dict[str, Any]] = {}
    for c in classes_all:
        st = latest.get(c)
        # Warm-up = J4 had no matured cycle k - d to consume (theta kept); error_rate alone is not reliable since
        # the column default (0.04) replaces a NULL on insert.
        warm = (st is None or st.error_rate is None
                or (st.review_index - d) not in matured.get(c, set()))
        theta = float(st.theta) if st is not None and st.theta is not None else None
        status[c] = dict(status=calibrator_service.controller_status(theta, warm),
                         theta=theta, review_index=int(st.review_index) if st is not None else None,
                         review_date=st.review_date.isoformat() if st is not None and st.review_date else None)

    out: Dict[str, Any] = dict(
        store_id=store_id, target=target, rolling_window_cycles=ROLLING_WINDOW, violation_tolerance=VIOLATION_TOL,
        recovery_tolerance=RECOVERY_TOL, recovery_sustained_windows=RECOVERY_SUSTAINED,
        lead_time_days=int(lead_time_days), event_date=event_date.isoformat() if event_date else None,
        classes_evaluated=classes,
    )
    if not cyc or not classes:
        return {**out, "n_complete_cycles": 0, "overall": None,
                "classes": {c: {**status[c], "n_sku": 0} for c in classes_all}}

    k0, k1 = min(cyc), max(cyc)
    ks = list(range(k0, k1 + 1))  # consecutive cycle indices; a missing cycle is a NaN row (breaks windows)
    E = np.full((len(ks), len(classes)), np.nan)
    starts = np.zeros(len(ks), dtype=int)
    ends = np.zeros(len(ks), dtype=int)
    present = np.zeros(len(ks), dtype=bool)
    for i, k in enumerate(ks):
        c = cyc.get(k)
        if c is None:
            continue
        present[i] = True
        starts[i] = pc.date_to_day_index(c["start"])
        ends[i] = pc.date_to_day_index(c["end"])
        for g, cl in enumerate(classes):
            if cl in c["e"]:
                E[i, g] = c["e"][cl]
    # fill indices of missing cycles (only used for eligibility arithmetic; their errors stay NaN)
    if not present.all():
        R = int(np.median(np.diff(starts[present]))) if present.sum() > 1 else pc.REVIEW_PERIOD_DAYS
        ref = int(np.flatnonzero(present)[0])
        for i in np.flatnonzero(~present):
            starts[i] = starts[ref] + (i - ref) * R
            ends[i] = ends[ref] + (i - ref) * R
    review_days = starts - int(lead_time_days)  # cycle j = days [t_j + L, t_j + L + R - 1]

    sm = service_metrics(E, target)
    rec_all = rec_cls = None
    if event_date is not None:
        ev = pc.date_to_day_index(event_date)
        rec_all = _f(recovery_days(review_days, ends, E, ev, target))
        rec_cls = [_f(recovery_days(review_days, ends, E[:, [g]], ev, target)) for g in range(len(classes))]

    per: Dict[str, Any] = {}
    for c in classes_all:
        if c not in classes:
            per[c] = {**status[c], "n_sku": 0}
            continue
        g = classes.index(c)
        per[c] = {
            **status[c], "n_sku": n_sku_of[c],
            "availability": sm["class_csl"][g],
            "rolling_violation": sm["class_rolling_violation"][g],
            "violating_windows": sm["class_violating_windows"][g],
            "last_rolling_availability": sm["class_last_rolling"][g],
            "recovery_days": rec_cls[g] if rec_cls is not None else None,
        }
    overall = {k: sm[k] for k in ("n_windows", "gap_mean", "signed_gap", "min_class_csl", "feasible", "feasible_1pp",
                                  "rolling_gap", "rolling_shortfall", "rolling_violation", "rolling_worst")}
    overall["recovery_days"] = rec_all
    overall["recovery_censored"] = (event_date is not None and rec_all is None)
    overall["n_boundary_classes"] = sum(1 for c in classes_all if status[c]["status"] == calibrator_service.STATUS_BOUNDARY)
    return {
        **out, "n_complete_cycles": int(present.sum()), "first_cycle_index": k0, "last_cycle_index": k1,
        "first_cycle_start": pc.day_index_to_date(int(starts[0])).isoformat(),
        "last_cycle_end": pc.day_index_to_date(int(ends[-1])).isoformat(),
        "overall": overall, "classes": per,
    }
