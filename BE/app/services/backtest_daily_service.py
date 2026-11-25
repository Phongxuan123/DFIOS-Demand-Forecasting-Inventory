"""Causal daily backtest forecasts for the replay charts (demo.md §2 "Backtest engine", §4.3 step 6, §1 causality).

``forecast_daily_backtest`` holds the backtest engine's rolling-origin point forecasts: origin ``o`` forecasts the days
``o .. o + 13`` from data before ``o`` (``y_h1 .. y_h14``). With the simulated clock at ``C`` (sales of ``C`` known):

* a past day ``D <= C`` gets ``y_h1`` of origin ``D``: the forecast of ``D`` made at the end of ``D - 1``;
* the days after ``C`` get the path of the latest origin ``o <= C + 1`` (made at the end of ``C``): 14 days ahead.

No origin later than ``C + 1`` is ever read, so the chart never shows a forecast that used sales after the clock.
The engine does not read this table (J3/J4 use the window quantiles of the same backtest run).
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Dict, List, Optional

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.forecast_daily_backtest import DAILY_HORIZONS, ForecastDailyBacktest as FDB
from app.models.product import Product

DAILY_BACKTEST_RUN = "backtest-ensemble-v1"


def _category_filter(q, category: Optional[str]):
    if category and category.strip() and category.strip().upper() != "ALL":
        c = category.strip()
        items = select(Product.item_id).where(or_(Product.cat_id == c, Product.dept_id == c))
        q = q.filter(FDB.item_id.in_(items))
    return q


def has_daily_backtest(db: Session, store_id: str, model_run: str = DAILY_BACKTEST_RUN) -> bool:
    return db.query(FDB.origin_date).filter(FDB.model_run == model_run, FDB.store_id == store_id).first() is not None


def store_daily_series(
    db: Session,
    store_id: str,
    clock_date: date,
    first_day: date,
    category: Optional[str] = None,
    future_days: int = DAILY_HORIZONS,
    model_run: str = DAILY_BACKTEST_RUN,
) -> Optional[Dict[str, object]]:
    """Store (or category) total of the causal backtest forecast per day, or None when the store has no rows.

    Returns ``{"series": {iso_day: value}, "model_run": ..., "past_horizon": 1, "future_as_of": iso | None}``:
    days ``first_day .. clock_date`` from the h = 1 forecasts, then up to ``future_days`` days after the clock from
    the latest origin ``<= clock_date + 1`` (``future_as_of`` = that origin - 1, the day whose sales close it)."""
    if not has_daily_backtest(db, store_id, model_run):
        return None
    base = db.query(FDB).filter(FDB.model_run == model_run, FDB.store_id == store_id)

    series: Dict[str, float] = {}
    past_q = _category_filter(
        db.query(FDB.origin_date, func.sum(FDB.y_h1)).filter(
            FDB.model_run == model_run, FDB.store_id == store_id,
            FDB.origin_date >= first_day, FDB.origin_date <= clock_date),
        category,
    ).group_by(FDB.origin_date)
    for od, total in past_q.all():
        series[str(od)] = round(float(total or 0.0), 1)

    future_as_of: Optional[str] = None
    n_future = max(0, min(int(future_days), DAILY_HORIZONS))
    if n_future:
        last_origin = base.with_entities(func.max(FDB.origin_date)).filter(
            FDB.origin_date <= clock_date + timedelta(days=1)).scalar()
        if last_origin is not None:
            cols: List = [func.sum(getattr(FDB, f"y_h{h}")) for h in range(1, DAILY_HORIZONS + 1)]
            sums = _category_filter(
                db.query(*cols).filter(FDB.model_run == model_run, FDB.store_id == store_id,
                                       FDB.origin_date == last_origin),
                category,
            ).one()
            added = 0
            for h, total in enumerate(sums, start=1):
                day = last_origin + timedelta(days=h - 1)
                if day <= clock_date or total is None:
                    continue
                if added >= n_future:
                    break
                series[str(day)] = round(float(total), 1)
                added += 1
            if added:
                future_as_of = str(last_origin - timedelta(days=1))
    return {"series": series, "model_run": model_run, "past_horizon": 1, "future_as_of": future_as_of}


BAND_LOOKBACK_DAYS = 364  # same residual lookback as the window quantiles (route c)
BAND_LOW, BAND_HIGH = 0.10, 0.90


def sku_daily_series(
    db: Session,
    store_id: str,
    item_id: str,
    clock_date: date,
    first_day: date,
    future_days: int = DAILY_HORIZONS,
    model_run: str = DAILY_BACKTEST_RUN,
) -> Optional[Dict[str, object]]:
    """One SKU's causal backtest forecast with an empirical error band (demo.md §4.2 Forecast Explorer:
    "dự báo 14 ngày tại as_of hiện tại … dải sai số cửa sổ (route c)").

    Same day rules as ``store_daily_series``. The band of a day forecast ``h`` days ahead is the forecast plus the
    10% / 90% quantiles of the SKU's own h-step errors (actual - y_h) over origins of the last ``BAND_LOOKBACK_DAYS``
    whose target day is ``<= clock_date`` (sales known at the clock), clamped at 0. Nothing after the clock is read.
    Returns ``{"points": {iso: {"predicted", "p10", "p90", "h"}}, "model_run", "future_as_of", "band_n": {h: n}}``
    or None when the SKU has no rows."""
    import numpy as np

    from app.models.sales_history import SalesHistory

    lo_origin = min(first_day, clock_date - timedelta(days=BAND_LOOKBACK_DAYS))
    hi_origin = clock_date + timedelta(days=1)
    rows = (
        db.query(FDB)
        .filter(FDB.model_run == model_run, FDB.store_id == store_id, FDB.item_id == item_id,
                FDB.origin_date >= lo_origin, FDB.origin_date <= hi_origin)
        .order_by(FDB.origin_date)
        .all()
    )
    if not rows:
        return None
    actual = {
        d: float(q or 0.0)
        for d, q in db.query(SalesHistory.sale_date, func.sum(SalesHistory.quantity))
        .filter(SalesHistory.store_id == store_id, SalesHistory.item_id == item_id,
                SalesHistory.sale_date >= lo_origin, SalesHistory.sale_date <= clock_date)
        .group_by(SalesHistory.sale_date)
        .all()
    }

    # h-step residuals known at the clock (target day <= clock_date, origin within the lookback)
    band_from = clock_date - timedelta(days=BAND_LOOKBACK_DAYS)
    resid: Dict[int, List[float]] = {h: [] for h in range(1, DAILY_HORIZONS + 1)}
    for r in rows:
        if r.origin_date < band_from:
            continue
        for h in range(1, DAILY_HORIZONS + 1):
            day = r.origin_date + timedelta(days=h - 1)
            if day > clock_date:
                break
            if day in actual:
                resid[h].append(actual[day] - float(getattr(r, f"y_h{h}")))
    q = {
        h: (float(np.quantile(v, BAND_LOW)), float(np.quantile(v, BAND_HIGH))) if v else None
        for h, v in resid.items()
    }

    def point(value: float, h: int) -> Dict[str, object]:
        b = q.get(h)
        return {
            "predicted": round(value, 2),
            "p10": round(max(0.0, value + b[0]), 2) if b else None,
            "p90": round(max(0.0, value + b[1]), 2) if b else None,
            "h": h,
        }

    points: Dict[str, Dict[str, object]] = {}
    by_origin = {r.origin_date: r for r in rows}
    d = first_day
    while d <= clock_date:
        r = by_origin.get(d)
        if r is not None:
            points[str(d)] = point(float(r.y_h1), 1)
        d += timedelta(days=1)

    future_as_of: Optional[str] = None
    last_origin = max((o for o in by_origin if o <= hi_origin), default=None)
    n_future = max(0, min(int(future_days), DAILY_HORIZONS))
    if last_origin is not None and n_future:
        r = by_origin[last_origin]
        added = 0
        for h in range(1, DAILY_HORIZONS + 1):
            day = last_origin + timedelta(days=h - 1)
            if day <= clock_date:
                continue
            if added >= n_future:
                break
            points[str(day)] = point(float(getattr(r, f"y_h{h}")), h)
            added += 1
        if added:
            future_as_of = str(last_origin - timedelta(days=1))
    return {
        "points": points,
        "model_run": model_run,
        "future_as_of": future_as_of,
        "band_n": {h: len(v) for h, v in resid.items()},
        "actual": {str(k): v for k, v in actual.items() if k >= first_day},
    }
