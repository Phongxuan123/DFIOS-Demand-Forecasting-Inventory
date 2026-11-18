from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.forecast_window_quantile import ForecastWindowQuantile
import app.models  # noqa: F401
from app.services import policy_config as pc
from app.services.optimization_service import optimization_service


def _session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine, autoflush=False)()


def _row(i, day):
    return ForecastWindowQuantile(
        id=f"r{i}", model_run_id="m", store_id="CA_1", item_id="X", origin_date=pc.day_index_to_date(day),
        horizon_days=pc.HORIZON_DAYS, point_window=1.0, q_levels={"0.95": 1.0}, route=pc.ROUTE_TEACHER,
        created_at=datetime.now(timezone.utc))


def test_review_chain_stays_on_the_weekly_teacher_grid_when_daily_origins_exist():
    db = _session()
    first = 1395
    for i, day in enumerate(range(first, first + 140)):
        db.add(_row(i, day))
    db.commit()
    R = pc.REVIEW_PERIOD_DAYS
    for refit in (first + 100, first + 103, first + 111):
        chain = optimization_service._simulation_reviews(db, "CA_1", [], refit)
        assert chain, refit
        assert chain[0] == first
        assert all((d - first) % R == 0 for d in chain)
        assert chain[-1] + R <= refit
        assert chain == sorted(chain)
        assert all(b - a == R for a, b in zip(chain, chain[1:]))
