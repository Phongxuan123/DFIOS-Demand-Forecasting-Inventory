"""P1 defaults: seed_demo writes the teacher setpoint 0.96 / theta 0; J5 refit every 91 days from the start only."""
import importlib.util
import pathlib
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.calibration_state import CalibrationState
from app.models.policy_selection import PolicySelection
from app.models.sim_clock import SimClock
from app.services import policy_config as pc
from app.services.simulator_service import REFIT_PERIOD_DAYS, is_refit_day

SCRIPTS = pathlib.Path(__file__).resolve().parents[1] / "scripts"


def _load_seed_demo():
    spec = importlib.util.spec_from_file_location("seed_demo_under_test", SCRIPTS / "seed_demo.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture()
def session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def test_seed_demo_defaults_and_idempotent(session_factory):
    seed = _load_seed_demo()
    seed.SessionLocal = session_factory
    seed.seed_demo_environment()
    seed.seed_demo_environment()  # idempotent
    db = session_factory()
    states = db.query(CalibrationState).all()
    assert len(states) == len(pc.ALL_CLASSES)
    for s in states:
        assert s.review_index == 0 and s.theta == 0.0 and s.multiplier == 1.0
        assert s.setpoint == pytest.approx(0.96)
    sels = db.query(PolicySelection).all()
    assert len(sels) == len(pc.ALL_CLASSES)
    assert all(p.setpoint == pytest.approx(0.96) for p in sels)
    assert db.query(SimClock).count() == 1


def test_scripts_do_not_warm_start_theta():
    cal = (SCRIPTS / "load_calibration_state.py").read_text(encoding="utf-8")
    assert "read_csv" not in cal and "pc.THETA_INIT" in cal
    sync = (SCRIPTS / "sync_scientific_baseline.py").read_text(encoding="utf-8")
    assert "theta_final" not in sync and "pc.TARGET_AVAILABILITY + pc.GUARD" not in sync


def test_refit_exactly_every_91_days():
    assert REFIT_PERIOD_DAYS == 91
    fired = [d for d in range(0, 500) if is_refit_day(d)]
    assert fired == [91, 182, 273, 364, 455]


def test_no_calendar_quarter_trigger():
    start = date(2016, 4, 25)
    for d in range(0, 400):
        t = start + timedelta(days=d)
        if t.day == 1 and t.month in (1, 4, 7, 10) and d % 91 != 0:
            assert not is_refit_day(d)
    # a quarter start that is not a multiple of 91 days from the start: 2016-07-01 is day 67
    assert not is_refit_day((date(2016, 7, 1) - start).days)
    assert is_refit_day((date(2016, 7, 25) - start).days)  # day 91
