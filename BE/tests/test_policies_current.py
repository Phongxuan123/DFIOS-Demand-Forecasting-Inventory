"""
GET /optimization/policies/current (demo.md 6.3): the (m_g, kappa_g) the engine uses per class for a store, with the
same resolution as J4 (store-specific J5 selection first, else the global one, newest wins; other stores ignored) and
the current theta_g. Tiny SQLite panel only.
"""
from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.models.base import Base
from app.models.calibration_state import CalibrationState
from app.models.policy_selection import PolicySelection
from app.models.user import User

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _client():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)
    db = Session()
    db.add(User(id="v1", email="viewer@dfios.com", password_hash=get_password_hash("Passw0rd!"), role="Viewer",
                display_name="Viewer", is_active=True, is_verified=True, token_version=1))
    rows = [
        ("quarter_2015_Q3", "AX", 0.10, 0.5, T0),                       # global
        ("quarter_2015_Q3", "BX", 0.20, 1.0, T0),                       # global, only selection for BX
        ("CA_1_refit_0", "AX", 0.30, 1.5, T0 + timedelta(days=1)),      # store-specific wins for AX
        ("TX_1_refit_0", "AY", 0.90, 2.0, T0 + timedelta(days=2)),      # another store: ignored for CA_1
    ]
    for sid, cls, m, k, at in rows:
        db.add(PolicySelection(selection_id=sid, class_id=cls, m_g=m, kappa_g=k, setpoint=0.96, val_cost=10.0,
                               val_service=0.97, is_feasible=True, source="j5_backtest", created_at=at))
    db.add(CalibrationState(id="cs1", calibrator_id="c3out", store_id="CA_1", class_id="AX", review_index=3, review_date=date(2016, 5, 16), theta=0.25,
                            multiplier=1.284, error_rate=0.05, at_boundary=False, setpoint=0.96))
    db.commit()
    db.close()

    def override():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = override
    c = TestClient(app)
    c.headers.update({"Authorization": "Bearer " + create_access_token(
        data={"sub": "viewer@dfios.com", "role": "Viewer", "user_id": "v1", "token_version": 1})})
    return c


def test_current_policies_follow_the_engine_resolution_and_carry_theta():
    c = _client()
    try:
        r = c.get("/api/v1/optimization/policies/current", params={"store_id": "CA_1"})
        assert r.status_code == 200, r.text
        by = {p["class_id"]: p for p in r.json()}
        assert set(by) == {"AX", "BX"}                       # AY only exists for TX_1
        assert (by["AX"]["selection_id"], by["AX"]["scope"], by["AX"]["m_g"], by["AX"]["kappa_g"]) == (
            "CA_1_refit_0", "store", 0.30, 1.5)
        assert (by["BX"]["selection_id"], by["BX"]["scope"]) == ("quarter_2015_Q3", "global")
        assert by["AX"]["theta"] == 0.25 and by["BX"]["theta"] == 0.0
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_current_policies_needs_a_signed_in_user():
    c = _client()
    try:
        c.headers.pop("Authorization")
        assert c.get("/api/v1/optimization/policies/current").status_code == 401
    finally:
        app.dependency_overrides.pop(get_db, None)
