"""
batch_runs (demo.md §5 / §6 step 7 / E7): every clock advance records its jobs with timings, a failed advance is
recorded as failed, and ``async_job=true`` returns 202 + run_id that the client polls. Tiny SQLite panels only.
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
from app.models.batch_run import BatchRun
from app.models.inventory import Inventory
from app.models.product import Product
from app.models.sales_history import SalesHistory
from app.models.sim_clock import SimClock
from app.models.user import User
from app.services.batch_service import batch_service
from app.services.simulator_service import simulator_service

START = date(2016, 4, 25)
STORE = "CA_1"
ITEM = "FOODS_1_001"
GEN = "app.services.replenishment_service.replenishment_service.generate_recommendations"


def _factory(n_days: int = 30):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)
    db = Session()
    db.add(SimClock(store_id=STORE, current_date=START, start_date=START))
    db.add(Product(item_id=ITEM, name="Item", cat_id="FOODS", dept_id="FOODS_1", price=10.0))
    db.add(Inventory(item_id=ITEM, store_id=STORE, on_hand=50.0, on_order=0.0))
    for i in range(n_days):
        db.add(SalesHistory(id=f"s{i}", item_id=ITEM, store_id=STORE, sale_date=START + timedelta(days=i),
                            quantity=1.0))
    db.commit()
    db.close()
    return Session


def test_sync_advance_records_advance_j1_and_review_jobs():
    Session = _factory()
    db = Session()
    with mock.patch(GEN, return_value=0):
        res = simulator_service.advance(db, STORE, days=14, triggered_by="admin@dfios.com")
    rows = db.query(BatchRun).filter(BatchRun.run_id == res["run_id"]).all()
    jobs = sorted(r.job for r in rows)
    # reviews at day 0, 7, 14 -> J3 + J4 each; J6 only from k = 2 (d = 2); one ADVANCE and one J1
    assert jobs.count("ADVANCE") == 1 and jobs.count("J1") == 1
    assert jobs.count("J3") == 3 and jobs.count("J4") == 3 and jobs.count("J6") == 1
    assert all(r.status == "success" and r.duration_ms is not None and r.duration_ms >= 0 for r in rows)
    j1 = next(r for r in rows if r.job == "J1")
    assert j1.details["days"] == 15 and j1.n_items == 1
    adv = next(r for r in rows if r.job == "ADVANCE")
    assert adv.triggered_by == "admin@dfios.com" and adv.details["reviews_executed"] == 3
    run = batch_service.get_run(db, res["run_id"])
    assert run["status"] == "success" and run["totals_by_job"]["J3"]["count"] == 3


def test_every_review_logs_a_j2_row_with_forecast_coverage():
    """research_v2 H7: J2 (the forecast served to the review) has its own batch row, before J3 fills gaps."""
    Session = _factory()
    db = Session()
    with mock.patch(GEN, return_value=0):
        res = simulator_service.advance(db, STORE, days=14)
    rows = db.query(BatchRun).filter(BatchRun.run_id == res["run_id"]).all()
    j2 = sorted((r for r in rows if r.job == "J2"), key=lambda r: r.review_index)
    assert [r.review_index for r in j2] == [0, 1, 2]
    for r in j2:
        assert r.status == "success" and r.duration_ms is not None and r.duration_ms >= 0
        d = r.details
        assert d["mode"] == "replay_precomputed" and d["horizon_days"] == 10
        # nothing was published for this tiny store, so the one SKU is left for J3 to compute
        assert d["items_published"] == r.n_items == 0 and d["items_missing"] == 1 and d["by_source"] == {}
    # J2 runs before J3 at the same review
    j3 = {r.review_index: r for r in rows if r.job == "J3"}
    assert all(r.started_at <= j3[r.review_index].started_at for r in j2)


def test_forecast_coverage_counts_published_rows_per_route_and_model():
    from app.models.forecast_window_quantile import ForecastWindowQuantile
    from app.services.window_quantile_service import DEFAULT_MODEL_RUN_ID, WindowQuantileService

    Session = _factory()
    db = Session()
    o = START + timedelta(days=7)
    for i, (item, route, model) in enumerate([("A", "teacher", None), ("B", "teacher", "chronos_bolt"),
                                              ("C", "c", None)]):
        db.add(ForecastWindowQuantile(id=f"w{i}", model_run_id=DEFAULT_MODEL_RUN_ID, store_id=STORE, item_id=item,
                                      origin_date=o, horizon_days=10, point_window=5.0, q_levels={"0.95": 8.0},
                                      route=route, source_model=model))
    # another origin and another model run are not counted
    db.add(ForecastWindowQuantile(id="w9", model_run_id=DEFAULT_MODEL_RUN_ID, store_id=STORE, item_id="D",
                                  origin_date=o + timedelta(days=7), horizon_days=10, point_window=1.0,
                                  q_levels={}, route="teacher"))
    db.add(ForecastWindowQuantile(id="w8", model_run_id="other-run", store_id=STORE, item_id="E",
                                  origin_date=o, horizon_days=10, point_window=1.0, q_levels={}, route="teacher"))
    db.commit()
    cov = WindowQuantileService.forecast_coverage(db, STORE, o, n_items=5, horizon_days=10)
    assert cov["items_published"] == 3 and cov["items_missing"] == 2
    assert cov["by_source"] == {"teacher:default": 1, "teacher:chronos_bolt": 1, "c:default": 1}


def test_failed_advance_is_rolled_back_and_recorded_as_failed():
    Session = _factory()
    db = Session()
    boom = RuntimeError("quantiles exploded")
    with mock.patch("app.services.window_quantile_service.window_quantile_service."
                    "get_or_create_window_quantiles_bulk", side_effect=boom), pytest.raises(RuntimeError):
        simulator_service.advance(db, STORE, days=3, run_id="run-x")
    db.expire_all()
    (row,) = db.query(BatchRun).filter(BatchRun.run_id == "run-x").all()
    assert (row.job, row.status) == ("ADVANCE", "failed") and "quantiles exploded" in row.error
    assert db.query(SimClock).one().current_date == START  # the simulation itself was rolled back


def test_validation_errors_are_not_batch_runs():
    Session = _factory(n_days=2)
    db = Session()
    with pytest.raises(HTTPException):
        simulator_service.advance(db, STORE, days=10)  # missing sales -> 400 before anything runs
    assert db.query(BatchRun).count() == 0


@pytest.fixture()
def admin_client():
    Session = _factory()

    def override():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    db = Session()
    db.add(User(id="a1", email="admin@dfios.com", password_hash=get_password_hash("Admin123"), role="Admin",
                display_name="Admin", is_active=True, is_verified=True, token_version=1))
    db.commit()
    db.close()
    app.dependency_overrides[get_db] = override
    batch_service.session_factory = Session
    token = create_access_token(data={"sub": "admin@dfios.com", "role": "Admin", "user_id": "a1",
                                      "token_version": 1})
    client = TestClient(app)
    client.headers.update({"Authorization": f"Bearer {token}"})
    yield client
    batch_service.session_factory = None
    app.dependency_overrides.pop(get_db, None)


def test_async_advance_returns_202_and_the_run_can_be_polled(admin_client):
    with mock.patch(GEN, return_value=0):
        r = admin_client.post("/api/v1/clock/advance", json={"store_id": STORE, "days": 7, "async_job": True})
        assert r.status_code == 202, r.text
        handle = r.json()
        assert handle["status"] == "running" and handle["poll_url"].endswith(handle["run_id"])
        batch_service.wait_idle()
    run = admin_client.get(f"/api/v1/batch-runs/{handle['run_id']}")
    assert run.status_code == 200
    body = run.json()
    assert body["status"] == "success" and body["job"] == "ADVANCE"
    assert {j["job"] for j in body["jobs"]} >= {"J1", "J3", "J4"}
    assert admin_client.get("/api/v1/clock", params={"store_id": STORE}).json()["current_date"] == str(
        START + timedelta(days=7))
    listing = admin_client.get("/api/v1/batch-runs", params={"job": "ADVANCE"}).json()
    assert listing["total"] == 1 and listing["items"][0]["run_id"] == handle["run_id"]


def test_async_advance_failure_is_visible_when_polled(admin_client):
    with mock.patch(GEN, return_value=0):
        r = admin_client.post("/api/v1/clock/advance", json={"store_id": STORE, "days": 60, "async_job": True})
        assert r.status_code == 202
        batch_service.wait_idle()
    body = admin_client.get(f"/api/v1/batch-runs/{r.json()['run_id']}").json()
    assert body["status"] == "failed" and "sales_history" in body["error"]


def test_unknown_run_is_404(admin_client):
    assert admin_client.get("/api/v1/batch-runs/nope").status_code == 404


def test_recover_orphans_marks_running_rows_failed():
    Session = _factory()
    db = Session()
    db.add(BatchRun(id="x", run_id="r", job="ADVANCE", status="running"))
    db.commit()
    assert batch_service.recover_orphans(db) == 1
    db.expire_all()
    assert db.get(BatchRun, "x").status == "failed"


REFIT = "app.services.optimization_service.optimization_service.refit_quarterly_policies"
FAKE_POLICIES = [{"selection_id": "CA_1_manual", "class_id": c, "m_g": 0.0, "kappa_g": 1.0} for c in ("AX", "AY")]


def _manager_token():
    return create_access_token(data={"sub": "manager@dfios.com", "role": "Warehouse Manager", "user_id": "m1",
                                     "token_version": 1})


@pytest.fixture()
def manager_client(admin_client):
    gen = app.dependency_overrides[get_db]()
    db = next(gen)
    db.add(User(id="m1", email="manager@dfios.com", password_hash=get_password_hash("Manager123"),
                role="Warehouse Manager", display_name="M", is_active=True, is_verified=True, token_version=1))
    db.commit()
    db.close()
    admin_client.headers.update({"Authorization": f"Bearer {_manager_token()}"})
    return admin_client


def test_manager_runs_j5_and_it_is_recorded(manager_client):
    with mock.patch(REFIT, return_value=FAKE_POLICIES) as refit, \
            mock.patch("app.api.v1.endpoints.optimization.PolicySelectionItem", side_effect=lambda **kw: kw):
        r = manager_client.post("/api/v1/optimization/refit-policies", json={"store_id": STORE})
    assert r.status_code == 200, r.text
    refit.assert_called_once()
    run = manager_client.get(f"/api/v1/batch-runs/{r.json()['run_id']}").json()
    assert (run["job"], run["status"], run["n_items"]) == ("J5", "success", 2)
    assert run["details"]["selection_id"] == "CA_1_manual" and run["triggered_by"] == "manager@dfios.com"


def test_async_j5_returns_job_id_and_failure_is_recorded(manager_client):
    with mock.patch(REFIT, side_effect=RuntimeError("grid failed")):
        r = manager_client.post("/api/v1/optimization/refit-policies", json={"store_id": STORE, "async_job": True})
        assert r.status_code == 202, r.text
        batch_service.wait_idle()
    run = manager_client.get(f"/api/v1/batch-runs/{r.json()['run_id']}").json()
    assert (run["job"], run["status"]) == ("J5", "failed") and "grid failed" in run["error"]


def test_queue_mode_records_queued_job_and_worker_claims_and_runs_it(monkeypatch):
    """docker compose: the API only queues (DFIOS_BATCH_EXECUTOR=queue); the worker claims and runs the job."""
    Session = _factory()
    monkeypatch.setenv("DFIOS_BATCH_EXECUTOR", "queue")
    batch_service.session_factory = Session
    try:
        db = Session()
        handle = batch_service.submit_advance(db, store_id=STORE, triggered_by="admin@dfios.com", days=7,
                                              until=None, reviews=None, approval_mode="auto", expire_pending=False)
        assert handle["status"] == "queued"
        db.expire_all()
        assert db.query(SimClock).one().current_date == START  # nothing ran in the "API"
        run_id = batch_service.claim_next(db)
        assert run_id == handle["run_id"] and batch_service.claim_next(db) is None  # claimed once
        with mock.patch(GEN, return_value=0):
            batch_service.execute(run_id)
        db.expire_all()
        run = batch_service.get_run(db, run_id)
        assert run["status"] == "success" and {j["job"] for j in run["jobs"]} >= {"J1", "J3", "J4"}
        assert db.query(SimClock).one().current_date == START + timedelta(days=7)
        assert db.query(BatchRun).filter(BatchRun.status.in_(("queued", "running"))).count() == 0
    finally:
        batch_service.session_factory = None


def test_queued_until_date_survives_the_json_round_trip(monkeypatch):
    Session = _factory()
    monkeypatch.setenv("DFIOS_BATCH_EXECUTOR", "queue")
    batch_service.session_factory = Session
    try:
        db = Session()
        h = batch_service.submit_advance(db, store_id=STORE, triggered_by=None, until=START + timedelta(days=3),
                                         days=None, reviews=None, approval_mode="auto", expire_pending=False)
        batch_service.claim_next(db)
        with mock.patch(GEN, return_value=0):
            batch_service.execute(h["run_id"])
        db.expire_all()
        assert db.query(SimClock).one().current_date == START + timedelta(days=3)
    finally:
        batch_service.session_factory = None


def test_recover_orphans_keeps_queued_jobs_for_the_worker():
    Session = _factory()
    db = Session()
    db.add(BatchRun(id="q", run_id="rq", job="ADVANCE", status="queued"))
    db.commit()
    assert batch_service.recover_orphans(db) == 0
    db.expire_all()
    assert db.get(BatchRun, "q").status == "queued"
