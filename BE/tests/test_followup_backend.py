"""Follow-up backend gaps (coverage_q95, replenishment context, products, dashboard, forecasts, schedules, users)."""
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core.security import create_access_token, get_password_hash
from app.main import app
from tests.artifact_marks import requires_c3ok_calibration, requires_c3ok_results
from app.models.base import Base
from app.models.calibration_state import CalibrationState
from app.models.classification import SKUClassification
from app.models.forecast import Forecast
from app.models.forecast_window_quantile import ForecastWindowQuantile
from app.models.inventory import Inventory
from app.models.inventory_param import InventoryParam
from app.models.model_registry import ModelRegistry
from app.models.policy_selection import PolicySelection
from app.models.product import Product
from app.models.replenishment import ReplenishmentRecommendation
from app.models.sales_history import SalesHistory
from app.models.sim_clock import SimClock
from app.models.user import User
from app.services import coverage_service
from app.services import scheduler_service

ORIGIN = date(2016, 4, 25)


@pytest.fixture()
def env():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)
    Base.metadata.create_all(bind=engine)

    def override():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
    coverage_service._db_cache.clear()
    with Session() as s:
        for uid, role in (("a1", "Admin"), ("m1", "Warehouse Manager"), ("v1", "Viewer")):
            s.add(User(id=uid, email=f"{uid}@dfios.com", password_hash=get_password_hash("Passw0rd1"), role=role,
                       is_active=True, is_verified=True, token_version=1))
        s.commit()

    def tok(uid, role):
        return {"Authorization": "Bearer " + create_access_token(
            {"sub": f"{uid}@dfios.com", "role": role, "user_id": uid, "token_version": 1})}

    yield {
        "Session": Session, "client": TestClient(app),
        "admin": tok("a1", "Admin"), "manager": tok("m1", "Warehouse Manager"), "viewer": tok("v1", "Viewer"),
    }
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.clear()


def _seed_registry(s):
    s.add(ModelRegistry(id="prod", name="Prod Ensemble", version="v1.0", algorithm="ensemble", scope="global",
                        is_production=True, metrics={"wrmsse": 0.4935, "mase": 0.9753},
                        created_at=datetime.now(timezone.utc), promoted_at=datetime.now(timezone.utc)))
    s.add(ModelRegistry(id="other", name="LGB", version="v1.0", algorithm="lightgbm", scope="global",
                        is_production=False, metrics={"wrmsse": 0.5083}, created_at=datetime.now(timezone.utc)))
    s.commit()


# ------------------------------------------------------------------ coverage_q95 (task 1)
@requires_c3ok_calibration
def test_artifact_coverage_is_real_and_labelled():
    art = coverage_service.artifact_coverage_q95()
    assert art is not None and abs(art["value"] - 0.8314) < 1e-4 and art["split"] == "test"
    cov = coverage_service.coverage_fields(None)
    assert cov["coverage_q95"] == art["value"] and cov["coverage_source"] == "artifact:c3ok"
    assert cov["coverage_q95_db_causal"] is None  # no DB -> never filled with the artifact number


def test_db_causal_coverage_separate_from_artifact(env):
    with env["Session"]() as s:
        s.add(Product(item_id="I1", name="p", cat_id="FOODS", dept_id="FOODS_1", price=2.0))
        s.add(Product(item_id="I2", name="p2", cat_id="FOODS", dept_id="FOODS_1", price=2.0))
        for k in range(10):  # 10 days of demand = 1/day (I1) and 5/day (I2)
            d = ORIGIN + timedelta(days=k)
            s.add(SalesHistory(id=f"I1_{k}", item_id="I1", store_id="CA_1", sale_date=d, quantity=1.0))
            s.add(SalesHistory(id=f"I2_{k}", item_id="I2", store_id="CA_1", sale_date=d, quantity=5.0))
        for iid, q95 in (("I1", 12.0), ("I2", 20.0)):  # I1 window 10 <= 12 covered, I2 window 50 > 20 not covered
            s.add(ForecastWindowQuantile(id=f"w_{iid}", model_run_id="r", store_id="CA_1", item_id=iid,
                                         origin_date=ORIGIN, horizon_days=10, point_window=9.0,
                                         q_levels={"0.95": q95}))
        s.commit()
        out = coverage_service.coverage_fields(s, "CA_1")
    assert out["coverage_q95_db_causal"] == 0.5 and out["coverage_q95_db_causal_n"] == 2
    assert out["coverage_q95"] == pytest.approx(0.8314, abs=1e-4)  # artifact value untouched


@requires_c3ok_results  # also reads /reports/policy-comparison (c3ok_results.csv)
@requires_c3ok_calibration
def test_registry_reports_and_dashboard_expose_coverage(env):
    c = env["client"]
    with env["Session"]() as s:
        _seed_registry(s)
    models = c.get("/api/v1/ml/models", headers=env["admin"]).json()["items"]
    prod = next(m for m in models if m["is_production"])
    assert prod["metrics"]["coverage_q95"] == pytest.approx(0.8314, abs=1e-4)
    assert prod["metrics"]["coverage_source"] == "artifact:c3ok"
    assert "coverage_q95" not in next(m for m in models if not m["is_production"])["metrics"]
    pol = c.get("/api/v1/reports/policy-comparison", headers=env["viewer"]).json()
    assert pol["coverage_source"] == "artifact:c3ok"
    if pol["policies"]:
        assert all(p["coverage_q95"] == pol["coverage_q95"] for p in pol["policies"].values())
    acc = c.get("/api/v1/reports/forecast-accuracy?model_name=ensemble", headers=env["viewer"]).json()
    assert acc["overall_metrics"]["coverage_q95"] == pytest.approx(0.8314, abs=1e-4)
    assert "coverage_q95_db_causal" in acc["overall_metrics"]


# ------------------------------------------------------------------ replenishment (task 3)
def test_replenishment_policy_context_sort_and_total_header(env):
    c = env["client"]
    with env["Session"]() as s:
        for i, (iid, qty) in enumerate((("I1", 30.0), ("I2", 10.0), ("I3", 20.0))):
            s.add(Product(item_id=iid, name=iid, cat_id="FOODS", dept_id="FOODS_1", price=3.0))
            s.add(Inventory(item_id=iid, store_id="CA_1", on_hand=1.0, on_order=0.0))
            s.add(InventoryParam(id=f"p{iid}", item_id=iid, store_id="CA_1", service_level=0.95, lead_time_days=3,
                                 safety_stock=1, reorder_point=5, eoq=10, annual_demand=100))
            s.add(SKUClassification(id=f"c{iid}", item_id=iid, store_id="CA_1", abc_class="A", xyz_class="X",
                                    segment="AX"))
            s.add(ReplenishmentRecommendation(id=f"r{iid}", item_id=iid, store_id="CA_1", recommended_qty=qty,
                                              final_qty=qty, priority="HIGH", status="PENDING"))
        s.add(CalibrationState(id="cs", calibrator_id="k", store_id="CA_1", class_id="AX", review_index=1,
                               review_date=ORIGIN, theta=0.25))
        s.add(PolicySelection(selection_id="sel", class_id="AX", m_g=0.0, kappa_g=1.5))
        s.add(ForecastWindowQuantile(id="w1", model_run_id="r", store_id="CA_1", item_id="I1", origin_date=ORIGIN,
                                     horizon_days=10, point_window=7.0, q_levels={"0.95": 13.5}))
        s.commit()
    r = c.get("/api/v1/replenishments?sort_by=final_qty&sort_dir=asc", headers=env["manager"])
    assert r.status_code == 200
    assert r.headers["X-Total-Count"] == "3"
    items = r.json()["items"]
    assert [i["final_qty"] for i in items] == [10.0, 20.0, 30.0]
    i1 = next(i for i in items if i["item_id"] == "I1")
    assert i1["abc_xyz_class"] == "AX" and i1["theta"] == pytest.approx(0.25) and i1["kappa_g"] == 1.5
    assert i1["m_g"] == 0.0 and i1["q_hat"] == 13.5 and i1["lead_time_days"] == 3
    assert next(i for i in items if i["item_id"] == "I2")["q_hat"] is None  # no quantile stored -> null, not invented
    assert c.get("/api/v1/replenishments?sort_by=bogus", headers=env["manager"]).status_code == 422
    h = c.get("/api/v1/replenishments/history?sort_by=item_id", headers=env["viewer"])
    assert h.status_code == 200 and "X-Total-Count" in h.headers


# ------------------------------------------------------------------ products (task 4)
def test_products_price_on_hand_and_s_S(env):
    c = env["client"]
    with env["Session"]() as s:
        s.add(Product(item_id="I1", name="one", cat_id="FOODS", dept_id="FOODS_1", price=4.5))
        s.add(Inventory(item_id="I1", store_id="CA_1", on_hand=7.0, on_order=0.0))
        s.add(InventoryParam(id="p1", item_id="I1", store_id="CA_1", service_level=0.95, lead_time_days=3,
                             safety_stock=1, reorder_point=5, eoq=10, annual_demand=100, s=12.0, S=30.0))
        s.commit()
    row = c.get("/api/v1/products?store_id=CA_1", headers=env["viewer"]).json()["items"][0]
    assert row["price"] == 4.5 and row["on_hand"] == 7.0 and row["s"] == 12.0 and row["S"] == 30.0
    one = c.get("/api/v1/products/I1", headers=env["viewer"]).json()
    assert one["price"] == 4.5 and one["on_hand"] is None


# ------------------------------------------------------------------ dashboard / calibration (task 5)
def test_dashboard_kpis_numeric_wrmsse_orders_and_global_calibration(env):
    c = env["client"]
    with env["Session"]() as s:
        _seed_registry(s)
        s.add(Product(item_id="I1", name="one", cat_id="FOODS", dept_id="FOODS_1", price=2.0))
        s.add(SimClock(store_id="CA_1", current_date=ORIGIN + timedelta(days=14), start_date=ORIGIN))
        for k, (st, d) in enumerate((("APPROVED", 3), ("COMPLETED", 8), ("PENDING", 9), ("APPROVED", -30))):
            s.add(ReplenishmentRecommendation(id=f"o{k}", item_id="I1", store_id="CA_1", recommended_qty=1,
                                              final_qty=1, priority="HIGH", status=st,
                                              review_date=ORIGIN + timedelta(days=d)))
        for idx, th in ((1, 0.1), (2, 0.2)):
            s.add(CalibrationState(id=f"cs{idx}", calibrator_id="k", store_id="CA_1", class_id="AX",
                                   review_index=idx, review_date=ORIGIN, theta=th))
        s.commit()
    k = c.get("/api/v1/dashboard/kpis?store_id=CA_1", headers=env["viewer"]).json()
    assert k["production_wrmsse"] == 0.4935 and k["production_model_id"] == "prod"
    assert k["orders_placed_count"] == 2  # APPROVED + COMPLETED inside the clock window only
    g = c.get("/api/v1/calibration/status?store_id=GLOBAL", headers=env["manager"]).json()
    one = c.get("/api/v1/calibration/status?store_id=CA_1", headers=env["manager"]).json()
    assert g["store_id"] == "GLOBAL" and g["thetas"]["AX"] == pytest.approx(one["thetas"]["AX"]) == pytest.approx(0.2)
    # history: readable by a Viewer, GLOBAL == CA_1 when one store is loaded
    hv = c.get("/api/v1/calibration/history?store_id=GLOBAL", headers=env["viewer"])
    assert hv.status_code == 200
    assert [r["theta"] for r in hv.json()] == [r["theta"] for r in
                                               c.get("/api/v1/calibration/history?store_id=CA_1", headers=env["viewer"]).json()]
    assert c.get("/api/v1/dashboard/kpi-dashboard?store_id=GLOBAL", headers=env["viewer"]).status_code == 200
    assert c.get("/api/v1/dashboard/kpi-dashboard?store_id=GLOBAL", headers=env["viewer"]).json()["store_id"] == "GLOBAL"


def test_demand_trend_keeps_predicted_null(env):
    with env["Session"]() as s:
        s.add(Product(item_id="I1", name="one", cat_id="FOODS", dept_id="FOODS_1", price=2.0))
        for k in range(5):
            s.add(SalesHistory(id=f"s{k}", item_id="I1", store_id="CA_1", sale_date=ORIGIN + timedelta(days=k), quantity=2.0))
        s.commit()
    data = env["client"].get("/api/v1/dashboard/demand-trend?store_id=CA_1&days=7", headers=env["viewer"]).json()["data"]
    assert data and all(p["predicted"] is None and p["actual"] is not None for p in data)


# ------------------------------------------------------------------ forecasts (task 6)
def _seed_forecasts(s):
    s.add(Product(item_id="I1", name="one", cat_id="FOODS", dept_id="FOODS_1", price=2.0))
    s.add(SimClock(store_id="CA_1", current_date=ORIGIN + timedelta(days=1), start_date=ORIGIN))
    now = datetime.now(timezone.utc)
    for ver, gen in (("Ensemble bundle 1.0", now), ("LightGBM v0.9", now - timedelta(days=1))):
        for h in (1, 2):
            s.add(Forecast(id=f"I1_CA_1_{ver}", item_id="I1", store_id="CA_1", forecast_date=ORIGIN + timedelta(days=h),
                           h=h, y_pred=3.0, available=True, model_version=ver, generated_at=gen))
    s.commit()


def test_forecast_list_single_version_model_name_backtest_and_global_422(env):
    c = env["client"]
    with env["Session"]() as s:
        _seed_forecasts(s)
    # SQLite shares the (forecast_date, h) PK + id across versions -> use distinct dates per version in this fixture
    r = c.get("/api/v1/forecasts?store_id=CA_1&horizon=7", headers=env["viewer"])
    assert r.status_code == 200
    body = r.json()
    assert len({i["model_version"] for i in body["items"]}) == 1  # never mixed
    assert sorted(body["available_versions"]) == ["Ensemble bundle 1.0", "LightGBM v0.9"]
    assert body["source"] == "production_artifact" or body["items"][0]["source"] in ("backtest", "production_artifact")
    lgb = c.get("/api/v1/forecasts?store_id=CA_1&horizon=7&model_name=lightgbm", headers=env["viewer"]).json()
    assert lgb["model_version"] == "LightGBM v0.9" and {i["model_version"] for i in lgb["items"]} <= {"LightGBM v0.9"}
    assert any(i["backtest"] for i in lgb["items"]) or lgb["items"] == []
    none = c.get("/api/v1/forecasts?store_id=CA_1&horizon=7&model_name=zzz", headers=env["viewer"]).json()
    assert none["items"] == [] and none["total"] == 0  # no silent fallback to another model
    for path in ("/api/v1/forecasts?store_id=GLOBAL", "/api/v1/forecasts/I1/compare?store_id=ALL",
                 "/api/v1/forecasts/I1/uncertainty?store_id=GLOBAL", "/api/v1/forecasts/I1/future?store_id=GLOBAL"):
        assert c.get(path, headers=env["viewer"]).status_code == 422, path


def test_forecast_compare_has_mase_and_version(env):
    c = env["client"]
    with env["Session"]() as s:
        s.add(Product(item_id="I1", name="one", cat_id="FOODS", dept_id="FOODS_1", price=2.0))
        train = [1, 3, 2, 4]  # naive one-step scale = mean(|2|,|1|,|2|) = 5/3
        for k, q in enumerate(train):
            s.add(SalesHistory(id=f"t{k}", item_id="I1", store_id="CA_1", sale_date=ORIGIN + timedelta(days=k), quantity=float(q)))
        for k, (a, p) in enumerate(((5, 4), (3, 4))):  # |errors| = 1, 1 -> MAE 1
            d = ORIGIN + timedelta(days=4 + k)
            s.add(SalesHistory(id=f"e{k}", item_id="I1", store_id="CA_1", sale_date=d, quantity=float(a)))
            s.add(Forecast(id="I1_CA_1_x", item_id="I1", store_id="CA_1", forecast_date=d, h=k + 1, y_pred=float(p),
                           available=True, model_version="Ensemble bundle 1.0"))
        s.commit()
    r = c.get("/api/v1/forecasts/I1/compare?store_id=CA_1", headers=env["viewer"]).json()
    assert r["model_version"] == "Ensemble bundle 1.0" and r["model_version_source"] == "resolved_ensemble"
    assert r["metrics"]["mase"] == pytest.approx(1.0 / (5.0 / 3.0), abs=1e-3) and r["metrics"]["mase_scale_n"] == 4
    h = c.get("/api/v1/forecasts/I1/history?store_id=GLOBAL", headers=env["viewer"]).json()
    assert h["count"] == 6 and h["total_quantity"] == 18.0  # real aggregate over stores


# ------------------------------------------------------------------ schedules / users / audit (task 7)
def test_cron_matching_and_next_run():
    t = datetime(2016, 5, 2, 2, 0, tzinfo=timezone.utc)  # a Monday
    assert scheduler_service.cron_matches("0 2 * * *", t)
    assert scheduler_service.cron_matches("*/15 0-3 * * 1", t)
    assert not scheduler_service.cron_matches("0 3 * * *", t)
    assert not scheduler_service.cron_matches("0 2 * * 0", t)
    assert scheduler_service.cron_matches("0 2 * * 7", t - timedelta(days=1))  # Sunday as 7
    nxt = scheduler_service.next_run("30 4 * * *", t)
    assert nxt == datetime(2016, 5, 2, 4, 30, tzinfo=timezone.utc)
    assert scheduler_service.scheduler_enabled() is False  # disabled under pytest


def test_schedule_mode_note_and_due_run(env, monkeypatch):
    c = env["client"]
    r = c.post("/api/v1/ml/schedule", json={"name": "n", "cron_expression": "0 2 * * *"}, headers=env["admin"])
    assert r.status_code == 201
    assert r.json()["mode"] == "manual" and "Stored only" in r.json()["note"]
    from app.services import scheduler_service as _ss
    _ss._state["running"] = True
    try:
        assert c.get("/api/v1/ml/schedule", headers=env["admin"]).json()["items"][0]["mode"] == "scheduled"
    finally:
        _ss._state["running"] = False
    lst = c.get("/api/v1/ml/schedule", headers=env["admin"]).json()["items"]
    assert lst and all(i["mode"] == "manual" and i["note"] for i in lst)

    from app.services.pipeline_service import pipeline_service
    calls = []
    monkeypatch.setattr(pipeline_service, "trigger_pipeline_run", lambda db, req, admin_email="": calls.append(req))
    with env["Session"]() as s:
        n = scheduler_service.run_due_schedules(s, datetime(2030, 1, 1, 2, 0, tzinfo=timezone.utc))
        assert n >= 1 and len(calls) == n
        again = scheduler_service.run_due_schedules(s, datetime(2030, 1, 1, 2, 0, tzinfo=timezone.utc))
        assert again == 0  # at most once per minute
        assert scheduler_service.run_due_schedules(s, datetime(2030, 1, 1, 5, 0, tzinfo=timezone.utc)) == 0


def test_revoke_tokens_users_total_and_audit_result(env):
    c = env["client"]
    assert c.get("/api/v1/auth/me", headers=env["viewer"]).status_code == 200
    r = c.post("/api/v1/users/v1/revoke-tokens", headers=env["admin"])
    assert r.status_code == 200
    assert c.get("/api/v1/auth/me", headers=env["viewer"]).status_code == 401  # old JWT dead
    assert c.post("/api/v1/users/a1/revoke-tokens", headers=env["manager"]).status_code == 403
    assert c.post("/api/v1/users/nope/revoke-tokens", headers=env["admin"]).status_code == 404
    lu = c.get("/api/v1/users?limit=1", headers=env["admin"])
    assert len(lu.json()) == 1 and lu.headers["X-Total-Count"] == "3"
    logs = c.get("/api/v1/audit-logs?action=revoke_tokens", headers=env["admin"]).json()["items"]
    assert logs and logs[0]["result"] == "SUCCESS" and logs[0]["result_source"] == "recorded"


def test_pipeline_pending_policy_for_import_permission_unchanged(env):
    # task 8: POST /imports stays Manager-or-Admin on the BE (Viewer is 403)
    r = env["client"].post("/api/v1/imports?store_id=CA_1", headers=env["viewer"], files={"file": ("a.csv", b"x\n")})
    assert r.status_code == 403


def test_calibration_history_tolerates_null_error_rate(env):
    """Artifact-loaded calibration rows have error_rate NULL: the endpoint must return it as null, not 500 (QA Q-01)."""
    with env["Session"]() as s:
        s.add(CalibrationState(id="cs_null", calibrator_id="k", store_id="CA_1", class_id="AX",
                               review_index=1, review_date=ORIGIN, theta=0.1))
        s.commit()
        s.execute(text("UPDATE calibration_state SET error_rate = NULL"))  # the column default would hide the NULL
        s.commit()
    r = env["client"].get("/api/v1/calibration/history?store_id=CA_1", headers=env["viewer"])
    assert r.status_code == 200
    assert r.json()[0]["error_rate"] is None


def test_recommendation_q_hat_and_theta_are_those_of_its_review_date(env):
    """The replay DB holds the window quantiles of every origin of the year: a proposal shows the Q_hat and theta of
    ITS review date (s = ceil(Q_hat * exp(m + theta)) checks on screen), not the newest origin's."""
    c = env["client"]
    later = ORIGIN + timedelta(days=364)
    with env["Session"]() as s:
        s.add(Product(item_id="I1", name="I1", cat_id="FOODS", dept_id="FOODS_1", price=3.0))
        s.add(Inventory(item_id="I1", store_id="CA_1", on_hand=1.0, on_order=0.0))
        s.add(InventoryParam(id="pI1", item_id="I1", store_id="CA_1", service_level=0.95, lead_time_days=3,
                             safety_stock=1, reorder_point=5, eoq=10, annual_demand=100))
        s.add(SKUClassification(id="cI1", item_id="I1", store_id="CA_1", abc_class="A", xyz_class="X", segment="AX"))
        s.add(ReplenishmentRecommendation(id="rI1", item_id="I1", store_id="CA_1", recommended_qty=4, final_qty=4,
                                          priority="HIGH", status="PENDING", review_date=ORIGIN,
                                          reorder_point_s=5, order_up_to_S=9))
        s.add(CalibrationState(id="cs0", calibrator_id="k", store_id="CA_1", class_id="AX", review_index=0,
                               review_date=ORIGIN, theta=0.1))
        s.add(CalibrationState(id="cs1", calibrator_id="k", store_id="CA_1", class_id="AX", review_index=52,
                               review_date=later, theta=0.9))
        s.add(PolicySelection(selection_id="sel", class_id="AX", m_g=-0.3, kappa_g=1.0))
        s.add(ForecastWindowQuantile(id="w0", model_run_id="r", store_id="CA_1", item_id="I1", origin_date=ORIGIN,
                                     horizon_days=10, point_window=4.0, q_levels={"0.95": 6.0}))
        s.add(ForecastWindowQuantile(id="w1", model_run_id="r", store_id="CA_1", item_id="I1", origin_date=later,
                                     horizon_days=10, point_window=9.0, q_levels={"0.95": 15.8}))
        s.commit()
    it = c.get("/api/v1/replenishments", headers=env["manager"]).json()["items"][0]
    assert it["q_hat"] == 6.0 and it["theta"] == pytest.approx(0.1)
