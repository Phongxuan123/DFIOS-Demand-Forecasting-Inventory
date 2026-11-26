"""research_v2 H5: slow read endpoints are served from a cache keyed by a fingerprint of the data they read."""
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.forecast_window_quantile import ForecastWindowQuantile
from app.models.inventory_param import InventoryParam
from app.models.sim_clock import SimClock
from app.services import result_cache

STORE = "CA_1"
DAY = date(2016, 4, 25)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine, expire_on_commit=False)()
    s.add(SimClock(store_id=STORE, current_date=DAY, start_date=DAY))
    s.commit()
    result_cache.clear()
    yield s
    s.close()
    result_cache.clear()


def test_same_data_same_arguments_is_computed_once(db):
    calls = []
    def compute():
        calls.append(1)
        return {"n": len(calls)}
    assert result_cache.cached(db, "x", STORE, (1,), compute) == {"n": 1}
    assert result_cache.cached(db, "x", STORE, (1,), compute) == {"n": 1}
    assert len(calls) == 1
    # other arguments or another endpoint name are other entries
    result_cache.cached(db, "x", STORE, (2,), compute)
    result_cache.cached(db, "y", STORE, (1,), compute)
    assert len(calls) == 3


@pytest.mark.parametrize("change", ["clock", "quantiles", "params"])
def test_any_input_change_recomputes(db, change):
    calls = []
    def compute():
        calls.append(1)
        return len(calls)
    result_cache.cached(db, "x", STORE, (), compute)
    if change == "clock":
        db.query(SimClock).filter(SimClock.store_id == STORE).one().current_date = DAY + timedelta(days=7)
    elif change == "quantiles":
        db.add(ForecastWindowQuantile(id="w1", model_run_id="r", store_id=STORE, item_id="I", origin_date=DAY,
                                      horizon_days=10, point_window=1.0, q_levels={"0.95": 2.0}))
    else:
        db.add(InventoryParam(id=f"{STORE}_I", item_id="I", store_id=STORE, safety_stock=0, reorder_point=1, eoq=1,
                              updated_at=datetime.now(timezone.utc)))
    db.commit()
    assert result_cache.cached(db, "x", STORE, (), compute) == 2


def test_warm_up_is_off_under_pytest():
    assert result_cache.warmup_enabled() is False
    assert result_cache.warm_in_background() is False
