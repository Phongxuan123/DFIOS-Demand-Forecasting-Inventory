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
