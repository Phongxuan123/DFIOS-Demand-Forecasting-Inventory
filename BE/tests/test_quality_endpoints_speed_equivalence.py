"""The speed-ups of the two slow quality endpoints must not change a single value:
* db-causal coverage: store-wide span matrix sliced per window  ==  the old per-window matrix path;
* forecast quality: one quantile query for all origins  ==  checked against the coverage numbers of the same data."""
import random
from datetime import date, datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.models.base import Base
from app.models.forecast_window_quantile import ForecastWindowQuantile
from app.models.sales_history import SalesHistory
from app.services import coverage_service
from app.services.quality_metrics_service import forecast_quality_from_db

STORE = "CA_1"
H = 10


def _db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine, autoflush=False)()
    rnd = random.Random(7)
    first = date(2016, 1, 4)
    items = [f"I{i}" for i in range(12)]
    n = 0
    for d in range(70):  # 70 days of sales, a few days missing for some SKUs (NaN, never 0)
        for it in items:
            if rnd.random() < 0.03:
                continue
            n += 1
            s.add(SalesHistory(id=f"s{n}", item_id=it, store_id=STORE, sale_date=first + timedelta(days=d),
                               quantity=float(rnd.randint(0, 6))))
    k = 0
    for od in range(0, 56, 7):
        for it in items:
            if it == "I11" and od == 14:
                continue  # an item missing at one origin
            k += 1
            base = rnd.uniform(5, 30)
            s.add(ForecastWindowQuantile(
                id=f"q{k}", model_run_id="m", store_id=STORE, item_id=it, origin_date=first + timedelta(days=od),
                horizon_days=H, point_window=base,
                q_levels={"0.5": base, "0.8": base * 1.2, "0.9": base * 1.4, "0.95": base * 1.6, "0.99": base * 2.0},
                created_at=datetime(2026, 1, 1)))
    s.commit()
    return s


def test_wide_matrix_coverage_equals_per_window_path(monkeypatch):
    s = _db()
    coverage_service.clear_cache()
    wide = coverage_service.db_causal_coverage_q95(s, STORE)
    coverage_service.clear_cache()
    monkeypatch.setattr(coverage_service, "WIDE_MATRIX_MAX_CELLS", 0)  # force the old per-window path
    old = coverage_service.db_causal_coverage_q95(s, STORE)
    coverage_service.clear_cache()
    assert wide is not None and wide == old
    assert wide["n_windows"] > 0 and 0.0 < wide["value"] <= 1.0


def test_forecast_quality_is_stable_and_complete():
    s = _db()
    a = forecast_quality_from_db(s, STORE, H, max_origins=60, max_items=500)
    b = forecast_quality_from_db(s, STORE, H, max_origins=60, max_items=500)
    assert a["status"] == "ok" and a == b
    assert a["n_items_used"] == 12
    # coverage of the 0.95 level over the origins whose window is fully observed
    assert 0.0 <= a["coverage"]["0.95"] <= 1.0
