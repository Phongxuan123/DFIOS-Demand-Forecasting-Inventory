"""research_v2 H1: the team's own window quantiles, route (c) from the backtest engine's daily forecasts.

Tiny SQLite panel: one SKU sells exactly 2 units a day, its daily forecast is 1.5 units a day (h = 1..14) at every
origin, so every closed window of H = 10 days has the residual 10 * (2 - 1.5) = 5 and Q_hat(tau) = 15 + 5 = 20.
"""
from datetime import date, timedelta

import numpy as np
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.forecast_daily_backtest import ForecastDailyBacktest
from app.models.forecast_window_quantile import ForecastWindowQuantile
from app.models.sales_history import SalesHistory
from app.services import policy_config as pc
from app.services.window_quantile_service import DEFAULT_MODEL_RUN_ID, WindowQuantileService

STORE, ITEM, OTHER = "CA_1", "FOODS_1_001", "FOODS_1_002"
FIRST = date(2016, 1, 4)        # first forecast origin (a Monday)
REVIEW = FIRST + timedelta(weeks=8)
H = 10


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine, expire_on_commit=False)()
    for d in range(0, 8 * 7 + 30):
        day = FIRST + timedelta(days=d)
        s.add(SalesHistory(id=f"s{d}", item_id=ITEM, store_id=STORE, sale_date=day, quantity=2.0))
        s.add(ForecastDailyBacktest(model_run=pc.TEAM_DAILY_MODEL_RUN, store_id=STORE, origin_date=day, item_id=ITEM,
                                    **{f"y_h{h}": 1.5 for h in range(1, 15)}))
    s.commit()
    yield s
    s.close()


def test_point_is_the_sum_of_the_daily_forecasts_and_residuals_are_causal(db):
    svc = WindowQuantileService()
    o = pc.date_to_day_index(REVIEW)
    m = svc.team_quantile_matrix(db, STORE, [ITEM, OTHER], [o], [0.5, 0.95], H)
    assert m["point"][0, 0] == pytest.approx(15.0)
    assert m["q"][0, 0, :] == pytest.approx([20.0, 20.0])
    # residual origins: the weekly grid of the review, windows closed before it (s + H <= o): 8 weeks back -> 7
    assert m["n_res"][0, 0] == 7
    # a SKU without daily forecasts is left to the other routes
    assert np.isnan(m["point"][1, 0]) and np.isnan(m["q"][1, 0, :]).all()


def test_future_sales_never_change_the_quantile(db):
    svc = WindowQuantileService()
    o = pc.date_to_day_index(REVIEW)
    before = svc.team_quantile_matrix(db, STORE, [ITEM], [o], [0.95], H)["q"][0, 0, 0]
    for r in db.query(SalesHistory).filter(SalesHistory.sale_date >= REVIEW).all():
        r.quantity = 500.0
    db.commit()
    assert svc.team_quantile_matrix(db, STORE, [ITEM], [o], [0.95], H)["q"][0, 0, 0] == before


def test_first_origin_without_any_closed_window_uses_the_point(db):
    svc = WindowQuantileService()
    m = svc.team_quantile_matrix(db, STORE, [ITEM], [pc.date_to_day_index(FIRST)], [0.95], H)
    assert m["n_res"][0, 0] == 0 and m["q"][0, 0, 0] == pytest.approx(15.0)


def test_team_mode_j3_replaces_the_imported_row(db, monkeypatch):
    db.add(ForecastWindowQuantile(id=f"{DEFAULT_MODEL_RUN_ID}_{STORE}_{ITEM}_{REVIEW}_{H}", model_run_id=DEFAULT_MODEL_RUN_ID,
                                  store_id=STORE, item_id=ITEM, origin_date=REVIEW, horizon_days=H, point_window=99.0,
                                  q_levels={"0.95": 123.0}, route=pc.ROUTE_TEACHER))
    db.commit()
    svc = WindowQuantileService()
    # default: the imported row is served as is
    rec = svc.get_or_create_window_quantiles_bulk(db, STORE, [ITEM], REVIEW, H)[ITEM]
    assert rec.route == pc.ROUTE_TEACHER and rec.q_levels["0.95"] == 123.0
    assert WindowQuantileService.forecast_coverage(db, STORE, REVIEW, 1, H)["by_source"] == {"teacher:default": 1}
    # team mode: J3 builds and stores the team's route (c) in its place
    monkeypatch.setattr(pc, "QUANTILE_SOURCE", pc.QUANTILE_SOURCE_TEAM)
    cov = WindowQuantileService.forecast_coverage(db, STORE, REVIEW, 1, H)
    assert cov["mode"] == "team_route_c" and cov["items_published"] == 0 and cov["items_missing"] == 1
    rec = svc.get_or_create_window_quantiles_bulk(db, STORE, [ITEM], REVIEW, H)[ITEM]
    assert rec.route == pc.ROUTE_EMPIRICAL and rec.source_model == pc.TEAM_SOURCE_MODEL
    assert rec.point_window == pytest.approx(15.0) and rec.q_levels["0.95"] == pytest.approx(20.0)
    rows = db.query(ForecastWindowQuantile).filter(ForecastWindowQuantile.item_id == ITEM).all()
    assert len(rows) == 1 and rows[0].source_model == pc.TEAM_SOURCE_MODEL
    # J5 reads the same numbers in team mode
    q = svc.causal_quantile_matrix(db, STORE, [ITEM], [pc.date_to_day_index(REVIEW)], 0.95, H)["q"]
    assert q[0, 0] == pytest.approx(20.0)
