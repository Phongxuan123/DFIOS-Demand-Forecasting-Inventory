"""
In-app model switch of the window-quantile source (demo.md §7 step 10, teacher E9c): only review origins the
simulation has not reached are replaced, every replaced row records its model, the switch is logged and can be
rolled back, and the engine then really orders from the new model's quantiles. Tiny SQLite panels only.
"""
from datetime import date, timedelta
from unittest import mock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.models.base import Base
from app.models.forecast_window_quantile import ForecastWindowQuantile
from app.models.inventory import Inventory
from app.models.inventory_daily import InventoryDaily
from app.models.product import Product
from app.models.sales_history import SalesHistory
from app.models.sim_clock import SimClock
from app.models.user import User
from app.models.window_quantile_source import WindowModelActivation, WindowQuantileSource
from app.services import policy_config as pc
from app.services.forecast_source_service import forecast_source_service
from app.services.window_quantile_service import DEFAULT_MODEL_RUN_ID

STORE = "CA_1"
T0 = date(2015, 11, 9)
ITEMS = ["FOODS_1_001", "FOODS_1_002"]
ORIGINS = [T0 + timedelta(days=7 * k) for k in range(4)]   # T0, T0+7, T0+14, T0+21
H = pc.HORIZON_DAYS


def _q(v: float) -> dict:
    return {str(t): v for t in (0.5, 0.9, 0.95, 0.99)}


def _session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)


def _panel(Session, clock_date: date = T0, simulated: bool = False):
    db = Session()
    db.add(SimClock(store_id=STORE, current_date=clock_date, start_date=T0))
    for iid in ITEMS:
        db.add(Product(item_id=iid, name=iid, cat_id="FOODS", dept_id="FOODS_1", price=3.0))
        db.add(Inventory(item_id=iid, store_id=STORE, on_hand=0.0, on_order=0.0))
        for od in ORIGINS:
            db.add(ForecastWindowQuantile(id=f"{DEFAULT_MODEL_RUN_ID}_{STORE}_{iid}_{od}_{H}",
                                          model_run_id=DEFAULT_MODEL_RUN_ID, store_id=STORE, item_id=iid,
                                          origin_date=od, horizon_days=H, point_window=10.0, q_levels=_q(10.0),
                                          route=pc.ROUTE_TEACHER, source_model="ensemble"))
            for model, v in (("ensemble", 10.0), ("chronos_bolt", 4.0)):
                db.add(WindowQuantileSource(id=f"{model}_{STORE}_{iid}_{od}_{H}", store_id=STORE, model=model,
                                            item_id=iid, origin_date=od, horizon_days=H, point_window=v,
                                            q_levels=_q(v)))
    if simulated:  # day T0 has been simulated (its review ran): not a clean start
        for iid in ITEMS:
            db.add(InventoryDaily(store_id=STORE, item_id=iid, date=T0, on_hand_end=0.0, on_order=0.0, sales=0.0,
                                  lost_sales=0.0, stockout=False))
    db.commit()
    return db


def _engine_rows(db):
    db.expire_all()
    return {(r.item_id, r.origin_date): (r.source_model, r.point_window)
            for r in db.query(ForecastWindowQuantile).filter_by(model_run_id=DEFAULT_MODEL_RUN_ID)}


def test_activation_replaces_only_origins_not_reviewed_yet():
    db = _panel(_session(), clock_date=ORIGINS[1], simulated=True)   # reviews T0 and T0+7 already ran
    res = forecast_source_service.activate(db, STORE, "chronos_bolt", actor="admin@dfios.com")
    assert (res["from_date"], res["n_origins"], res["n_rows"], res["previous_model"]) == (
        ORIGINS[2], 2, 4, "ensemble")
    rows = _engine_rows(db)
    for iid in ITEMS:
        assert rows[(iid, ORIGINS[0])] == ("ensemble", 10.0)
        assert rows[(iid, ORIGINS[1])] == ("ensemble", 10.0)   # today's review already ran: kept
        assert rows[(iid, ORIGINS[2])] == ("chronos_bolt", 4.0)
        assert rows[(iid, ORIGINS[3])] == ("chronos_bolt", 4.0)
    assert len(rows) == len(ITEMS) * len(ORIGINS)                 # replaced, never duplicated
    ov = forecast_source_service.overview(db, STORE)
    assert ov["active_model"] == "chronos_bolt" and ov["activations"][0]["previous_model"] == "ensemble"
    assert {m["model"] for m in ov["available_models"]} == {"ensemble", "chronos_bolt"}


def test_clean_start_includes_the_day0_origin_and_rollback_restores_the_previous_model():
    db = _panel(_session(), clock_date=T0, simulated=False)
    assert forecast_source_service.activate(db, STORE, "chronos_bolt")["from_date"] == T0
    assert {v for v in _engine_rows(db).values()} == {("chronos_bolt", 4.0)}
    back = forecast_source_service.activate(db, STORE, "ensemble")
    assert back["previous_model"] == "chronos_bolt"
    assert {v for v in _engine_rows(db).values()} == {("ensemble", 10.0)}
    assert db.query(WindowModelActivation).count() == 2


def test_unknown_model_is_422_and_changes_nothing():
    db = _panel(_session())
    before = _engine_rows(db)
    with pytest.raises(HTTPException) as ei:
        forecast_source_service.activate(db, STORE, "lstm")
    assert ei.value.status_code == 422
    assert _engine_rows(db) == before


def test_engine_orders_from_the_activated_model():
    """After the switch the simulator's J4 reads the new model's Q_hat (no engine change needed)."""
    from app.services.simulator_service import simulator_service

    Session = _session()
    db = _panel(Session, clock_date=T0)
    for iid in ITEMS:
        for j in range(-60, 30):
            d = T0 + timedelta(days=j)
            db.add(SalesHistory(id=f"{iid}_{j}", item_id=iid, store_id=STORE, sale_date=d, quantity=1.0))
    db.commit()
    seen = {}

    def spy(db_, store_id, item_ids, origin_date, horizon_days=H, **kw):
        out = orig(db_, store_id, item_ids, origin_date, horizon_days, **kw)
        seen[origin_date] = {r.source_model for r in out.values()}
        return out

    from app.services.window_quantile_service import window_quantile_service
    orig = window_quantile_service.get_or_create_window_quantiles_bulk
    with mock.patch.object(window_quantile_service, "get_or_create_window_quantiles_bulk", side_effect=spy):
        simulator_service.advance(db, STORE, until=ORIGINS[1])            # reviews T0, T0+7 on ensemble
        forecast_source_service.activate(db, STORE, "chronos_bolt")
        simulator_service.advance(db, STORE, until=ORIGINS[3])            # reviews T0+14, T0+21 on chronos
    assert seen[ORIGINS[0]] == {"ensemble"} and seen[ORIGINS[1]] == {"ensemble"}
    assert seen[ORIGINS[2]] == {"chronos_bolt"} and seen[ORIGINS[3]] == {"chronos_bolt"}


def test_activation_endpoint_is_admin_only():
    Session = _session()
    _panel(Session)

    def override():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    s = Session()
    for uid, email, role in (("a1", "admin@dfios.com", "Admin"), ("m1", "manager@dfios.com", "Warehouse Manager")):
        s.add(User(id=uid, email=email, password_hash=get_password_hash("Passw0rd!"), role=role, display_name=role,
                   is_active=True, is_verified=True, token_version=1))
    s.commit()
    s.close()
    app.dependency_overrides[get_db] = override
    try:
        def client(uid, email, role):
            c = TestClient(app)
            c.headers.update({"Authorization": "Bearer " + create_access_token(
                data={"sub": email, "role": role, "user_id": uid, "token_version": 1})})
            return c

        mgr = client("m1", "manager@dfios.com", "Warehouse Manager")
        assert mgr.post("/api/v1/forecast-sources/activate", json={"model": "chronos_bolt"}).status_code == 403
        adm = client("a1", "admin@dfios.com", "Admin")
        r = adm.post("/api/v1/forecast-sources/activate", json={"store_id": STORE, "model": "chronos_bolt"})
        assert r.status_code == 200, r.text
        assert r.json()["model"] == "chronos_bolt"
        ov = adm.get("/api/v1/forecast-sources", params={"store_id": STORE}).json()
        assert ov["active_model"] == "chronos_bolt" and ov["activations"][0]["activated_by"] == "admin@dfios.com"
    finally:
        app.dependency_overrides.pop(get_db, None)
