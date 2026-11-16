"""
Regression tests of ROUND 5 (backend): FR10 what-if simulation, honest fast-inference, compare MAE null, sales
import counters, cheap alert summary, stable *_code fields, audit result column, shared login limiter, class_source
provenance, default schedule never written by a GET, pending proposals rebuilt from the baseline, coverage cache key,
P-45 repository hygiene, deprecations.
"""
import io
import os
import re
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.models.audit_log import LoginFailure
from app.models.base import Base
from app.models.classification import SKUClassification
from app.models.forecast import Forecast
from app.models.forecast_backtest import ForecastBacktest
from app.models.forecast_window_quantile import ForecastWindowQuantile
from app.models.inventory import Inventory
from app.models.inventory_param import InventoryParam
from app.models.product import Product
from app.models.replenishment import ReplenishmentRecommendation
from app.models.sales_history import SalesHistory
from app.models.sim_clock import SimClock
from app.models.system_setting import SystemSetting
from app.models.user import User
from app.services import coverage_service
from app.services import policy_backtest
from app.services import policy_config as pc

BE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
STORE = "CA_1"


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
    coverage_service.clear_cache()
    with Session() as s:
        for uid, role in (("a1", "Admin"), ("m1", "Warehouse Manager"), ("v1", "Viewer")):
            s.add(User(id=uid, email=f"{uid}@dfios.com", password_hash=get_password_hash("Passw0rd1"), role=role,
                       is_active=True, is_verified=True, token_version=1))
        s.commit()

    def tok(uid, role):
        return {"Authorization": "Bearer " + create_access_token(
            {"sub": f"{uid}@dfios.com", "role": role, "user_id": uid, "token_version": 1})}

    yield {"Session": Session, "client": TestClient(app), "admin": tok("a1", "Admin"),
           "manager": tok("m1", "Warehouse Manager"), "viewer": tok("v1", "Viewer")}
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


# ------------------------------------------------------------------ FR10 what-if
O_IDX = 1700
ITEMS = [f"FOODS_1_{i:03d}" for i in range(1, 7)]


def _seed_what_if(s, with_price=True, spacing=7):
    s.add(SimClock(store_id=STORE, current_date=pc.day_index_to_date(O_IDX), start_date=pc.day_index_to_date(O_IDX)))
    reviews = [O_IDX - spacing - spacing * k for k in range(0, 40)]
    rng = np.random.default_rng(7)
    for n, it in enumerate(ITEMS):
        seg = "AX" if n < 3 else "BY"
        s.add(Product(item_id=it, name=it, cat_id="FOODS", price=(4.0 if with_price else 0.0)))
        s.add(SKUClassification(id=f"c_{it}", item_id=it, store_id=STORE, abc_class=seg[0], xyz_class=seg[1],
                                segment=seg))
        for k, r in enumerate(reviews):
            s.add(ForecastBacktest(id=f"b_{it}_{k}", store_id=STORE, item_id=it, review_day=r, dhat=30.0,
                                   dhat_lgb=1.0, sigma_d=1.5, model_run="backtest-ensemble-v1"))
        for d in range(min(reviews) - 5, O_IDX):
            s.add(SalesHistory(id=f"s_{it}_{d}", item_id=it, store_id=STORE, sale_date=pc.day_index_to_date(d),
                               quantity=float(rng.poisson(3.0))))
    s.commit()


def test_what_if_is_a_real_simulation_per_class(env):
    c = env["client"]
    with env["Session"]() as s:
        _seed_what_if(s)
    body = {"store_id": STORE, "lead_time_days": 3, "review_period_days": 7, "n_reviews": 10,
            "policies": [{"policy_key": "custom", "m_g": 0.2, "kappa_g": 1.0},
                         {"policy_key": "raw", "m_g": 0.0, "kappa_g": 0.0}]}
    r = c.post("/api/v1/simulation/what-if", json=body, headers=env["manager"])
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["source"] == "simulated" and d["simulated"] is True
    assert d["horizon_days"] == 10 and d["n_reviews"] == 10
    assert d["period_end"] < pc.day_index_to_date(O_IDX).isoformat()  # replay strictly before the clock
    custom = next(p for p in d["policies"] if p["policy_key"] == "custom")
    assert {x["class_id"] for x in custom["by_class"]} == {"AX", "BY"}
    ov = custom["overall"]
    assert ov["n_items"] == 6 and ov["n_sku_periods"] == 60
    assert abs(ov["total_cost"] - (ov["holding_cost"] + ov["shortage_cost"] + ov["ordering_cost"])) < 0.05
    assert ov["ordering_cost"] == pytest.approx(ov["orders"] * 2.0)
    assert 0.0 <= ov["availability"] <= 1.0
    # more protection (m = 0.2, kappa = 1) can never be LESS available than order-up-to-Q_hat
    raw = next(p for p in d["policies"] if p["policy_key"] == "raw")["overall"]
    assert ov["availability"] >= raw["availability"]


def test_what_if_matches_the_backtest_engine_and_uses_the_given_costs(env):
    from app.services.what_if_service import what_if_service
    from app.schemas.simulation import WhatIfRequest
    with env["Session"]() as s:
        _seed_what_if(s)
        base = WhatIfRequest(store_id=STORE, n_reviews=8, classes=["AX"],
                             policies=[{"policy_key": "p", "m_g": 0.1, "kappa_g": 1.5}])
        res = what_if_service.run(s, base).policies[0].by_class[0]
        # same inputs straight into the engine -> identical numbers
        data, _ = what_if_service._class_inputs(s, STORE, "AX", O_IDX, 8, 0.95, 3, 7, 0.002, 2.0)
        eng = policy_backtest.simulate_rss_candidates(data["dem"], data["q"], data["eoq"], data["price"], [0.1], [1.5])
        assert res.total_cost == pytest.approx(round(float(eng.cost[0]), 2))
        assert res.availability == pytest.approx(round(float(eng.availability[0]), 5))
        # b does not enter s, S or EOQ: doubling it doubles the shortage cost and leaves stock / orders unchanged
        dear = what_if_service.run(s, base.model_copy(update={"stockout_penalty_rate": 0.70})).policies[0].by_class[0]
        assert dear.shortage_cost == pytest.approx(res.shortage_cost * 2, rel=1e-6, abs=0.02)
        assert dear.holding_cost == pytest.approx(res.holding_cost) and dear.orders == res.orders


def test_what_if_lead_time_changes_the_result(env):
    from app.services.what_if_service import what_if_service
    from app.schemas.simulation import WhatIfRequest
    with env["Session"]() as s:
        _seed_what_if(s)
        pol = [{"policy_key": "p", "m_g": 0.0, "kappa_g": 1.0}]
        l1 = what_if_service.run(s, WhatIfRequest(store_id=STORE, lead_time_days=1, n_reviews=8, policies=pol))
        l7 = what_if_service.run(s, WhatIfRequest(store_id=STORE, lead_time_days=7, n_reviews=8, policies=pol))
        assert (l1.horizon_days, l7.horizon_days) == (8, 14)
        assert l1.policies[0].overall.model_dump() != l7.policies[0].overall.model_dump()


def test_what_if_rejects_unsupported_inputs_with_reasons(env):
    c = env["client"]
    with env["Session"]() as s:
        _seed_what_if(s)
    r1 = c.post("/api/v1/simulation/what-if", json={"store_id": STORE, "review_period_days": 1}, headers=env["admin"])
    assert r1.status_code == 422 and r1.json()["detail"]["reason_code"] == "unsupported_review_period"
    r2 = c.post("/api/v1/simulation/what-if", json={"store_id": STORE, "lead_time_days": 2}, headers=env["admin"])
    assert r2.status_code == 422  # L outside {1, 3, 7}
    r3 = c.post("/api/v1/simulation/what-if", json={"store_id": "NOPE_1"}, headers=env["admin"])
    assert r3.status_code == 422 and r3.json()["detail"]["reason_code"] == "no_review_forecasts"
    r4 = c.post("/api/v1/simulation/what-if", json={"store_id": STORE, "policies": [{"policy_key": "x"}]},
                headers=env["admin"])
    assert r4.status_code == 422 and r4.json()["detail"]["reason_code"] == "policy_params_missing"
    assert c.post("/api/v1/simulation/what-if", json={"store_id": STORE}, headers=env["viewer"]).status_code == 403


def test_what_if_without_prices_is_insufficient_not_invented(env):
    c = env["client"]
    with env["Session"]() as s:
        _seed_what_if(s, with_price=False)
    r = c.post("/api/v1/simulation/what-if", json={"store_id": STORE}, headers=env["admin"])
    assert r.status_code == 422
    det = r.json()["detail"]
    assert det["reason_code"] == "insufficient_data"
    assert {x["reason_code"] for x in det["skipped_classes"]} >= {"no_complete_items"}


# ------------------------------------------------------------------ R-37 fast inference
def _seed_store_sales(s, store, days=28):
    s.add(Product(item_id="SKU_A", name="A", cat_id="FOODS", price=2.0))
    for d in range(days):
        s.add(SalesHistory(id=f"{store}_{d}", item_id="SKU_A", store_id=store,
                           sale_date=date(2016, 3, 1) + timedelta(days=d), quantity=float(d % 4)))
    s.commit()


def test_fast_inference_uses_the_production_forecast_when_present(env):
    c = env["client"]
    with env["Session"]() as s:
        _seed_store_sales(s, "NEW_2")
        for h in range(1, 8):
            s.add(Forecast(id=f"ens_{h}", item_id="SKU_A", store_id="NEW_2",
                           forecast_date=date(2016, 3, 28) + timedelta(days=h),
                           h=h, y_pred=1.5, available=True, model_version="Ensemble-v1"))
        s.commit()
    r = c.post("/api/v1/forecast/fast-inference", json={"store_id": "NEW_2", "horizon": 14}, headers=env["admin"])
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["source"] == "production_forecast" and d["model_version"] == "Ensemble-v1"
    assert d["records_generated"] == 0 and d["records_available"] == 7
    with env["Session"]() as s:
        assert s.query(Forecast).filter(Forecast.model_version == "fast-inference-sba").count() == 0
    forced = c.post("/api/v1/forecast/fast-inference", json={"store_id": "NEW_2", "horizon": 14,
                                                             "prefer_production": False}, headers=env["admin"]).json()
    assert forced["source"] == "sba_fallback" and forced["records_generated"] == 14
    assert forced["history_end"] == "2016-03-28" and "NOT the production" in forced["note"]


# ------------------------------------------------------------------ compare MAE null
def test_compare_metrics_are_null_without_data_points(env):
    c = env["client"]
    with env["Session"]() as s:
        s.add(Product(item_id="SKU_A", name="A", cat_id="FOODS", price=2.0))
        s.add(Forecast(id="f1", item_id="SKU_A", store_id=STORE, forecast_date=date(2016, 6, 1), h=1, y_pred=2.0,
                       available=True, model_version="Ensemble-v1"))
        s.commit()
    r = c.get("/api/v1/forecasts/SKU_A/compare?store_id=CA_1", headers=env["viewer"])
    assert r.status_code == 200, r.text
    m = r.json()["metrics"]
    assert m["data_points"] == 0
    assert m["mae"] is None and m["rmse"] is None  # was 0.0
    assert m["metrics_reason_code"] == "no_actuals" and m["metrics_reason"]


# ------------------------------------------------------------------ /sales/import counters
def test_sales_import_counts_updates_separately(env):
    c = env["client"]
    with env["Session"]() as s:
        s.add(Product(item_id="SKU_A", name="A", cat_id="FOODS", price=2.0))
        s.commit()

    def up(text):
        return c.post("/api/v1/sales/import", files={"file": ("s.csv", io.BytesIO(text.encode()), "text/csv")},
                      headers=env["admin"])

    first = up("item_id,store_id,sale_date,quantity\nSKU_A,CA_9,2016-03-01,2\nSKU_A,CA_9,2016-03-02,3\n").json()
    assert (first["inserted"], first["updated"], first["imported_count"]) == (2, 0, 2)
    second = up("item_id,store_id,sale_date,quantity\nSKU_A,CA_9,2016-03-02,9\nSKU_A,CA_9,2016-03-03,1\n"
                "SKU_A,CA_9,2016-03-03,4\n")
    assert second.status_code == 200, second.text  # an existing row used to be re-inserted (PK clash)
    d = second.json()
    assert (d["inserted"], d["updated"], d["duplicate_rows"]) == (1, 1, 1)
    with env["Session"]() as s:
        q = {r.sale_date: r.quantity for r in s.query(SalesHistory).filter(SalesHistory.store_id == "CA_9")}
        assert q == {date(2016, 3, 1): 2.0, date(2016, 3, 2): 9.0, date(2016, 3, 3): 4.0}
        clock = s.query(SimClock).filter(SimClock.store_id == "CA_9").one()
        assert clock.current_date == clock.start_date == date(2016, 3, 1)


# ------------------------------------------------------------------ alerts: cheap summary + codes
def _seed_alert_state(s):
    rows = [("A", 0.0, 0.0), ("B", 2.0, 0.0), ("C", 8.0, 0.0), ("D", 50.0, 0.0), ("E", 40.0, 5.0)]
    for it, oh, oo in rows:
        s.add(Product(item_id=it, name=it, cat_id="FOODS", price=1.0))
        s.add(Inventory(item_id=it, store_id=STORE, on_hand=oh, on_order=oo))
        s.add(InventoryParam(id=f"{STORE}_{it}", item_id=it, store_id=STORE, safety_stock=5.0, reorder_point=10.0,
                             eoq=5.0, s=10.0, S=20.0))
    s.add(Inventory(item_id="A", store_id="TX_1", on_hand=0.0, on_order=0.0))  # other store
    s.commit()


def test_alert_summary_is_an_aggregate_and_items_carry_codes(env):
    c = env["client"]
    with env["Session"]() as s:
        _seed_alert_state(s)
    r = c.get("/api/v1/dashboard/alerts?store_id=CA_1&severity=CRITICAL&limit=1", headers=env["viewer"]).json()
    assert r["summary"] == {"critical_count": 2, "warning_count": 1, "healthy_count": 2, "total_monitored": 5}
    assert r["total"] == 2 and len(r["items"]) == 1
    it = r["items"][0]
    assert it["severity"] == "CRITICAL" and it["suggested_action_code"] in ("out_of_stock", "below_ss_and_rop")
    full = c.get("/api/v1/dashboard/alerts?store_id=CA_1&limit=50", headers=env["viewer"]).json()
    assert [x["severity"] for x in full["items"]] == ["CRITICAL", "CRITICAL", "WARNING", "HEALTHY", "HEALTHY"]
    codes = {x["item_id"]: x["suggested_action_code"] for x in full["items"]}
    assert codes == {"A": "out_of_stock", "B": "below_ss_and_rop", "C": "ip_below_rop", "D": "healthy", "E": "healthy"}
    c_item = next(x for x in full["items"] if x["item_id"] == "C")
    assert c_item["suggested_action_params"]["inventory_position"] == 8.0
    glob = c.get("/api/v1/dashboard/alerts?store_id=GLOBAL&limit=2&offset=1", headers=env["viewer"]).json()
    assert glob["summary"]["total_monitored"] == 6 and glob["total"] == 6 and len(glob["items"]) == 2


# ------------------------------------------------------------------ stable codes (KPI, replenishment, classification)
def test_kpi_dashboard_reason_codes(env):
    c = env["client"]
    none = c.get("/api/v1/kpi/dashboard?store_id=ZZ_9", headers=env["admin"]).json()
    assert none["availability_reason_code"] == "no_clock" and none["insight_details"][0]["code"] == "no_clock"
    with env["Session"]() as s:
        s.add(SimClock(store_id=STORE, current_date=date(2016, 4, 25), start_date=date(2016, 4, 25)))
        s.commit()
    d = c.get("/api/v1/kpi/dashboard?store_id=CA_1", headers=env["admin"]).json()
    assert d["availability_reason_code"] == "no_closed_cycle"
    assert d["cost_reason_code"] == "no_simulated_days"
    assert len(d["insight_details"]) == len(d["summary_insights"])


def test_replenishment_reason_code_and_store_scoped_counters(env):
    from app.services.replenishment_service import replenishment_service
    with env["Session"]() as s:
        s.add(Product(item_id="P1", name="P1", cat_id="FOODS", price=1.0))
        s.add(Inventory(item_id="P1", store_id=STORE, on_hand=3.0, on_order=0.0))
        s.add(InventoryParam(id=f"{STORE}_P1", item_id="P1", store_id=STORE, safety_stock=5.0, reorder_point=20.0,
                             eoq=10.0, s=20.0, S=37.0))
        s.add(ReplenishmentRecommendation(id="other", item_id="P1", store_id="TX_1", recommended_qty=1, final_qty=1,
                                          priority="LOW", status="PENDING", created_at=datetime.now(timezone.utc)))
        s.commit()
        assert replenishment_service.generate_recommendations(s, STORE, review_date=date(2016, 4, 25)) == 1
        lst = replenishment_service.list_recommendations(s, store_id=STORE)
        assert lst.pending_count == 1  # the TX_1 row is not counted for CA_1 any more
        item = lst.items[0]
        assert item.reason_code == "ip_below_s"
        params = dict(item.reason_params)
        assert params.pop("policy") == item.policy_applied
        assert params == {"inventory_position": 3.0, "s": 20.0, "S": 37.0, "q": 34.0}


def test_classification_recommendations_have_codes(env):
    r = env["client"].get("/api/v1/classification/recommendations/AX", headers=env["admin"])
    assert r.status_code == 200, r.text
    rec = r.json()
    assert rec["review_frequency_code"] == "daily" and rec["priority_code"] == "critical"
    assert rec["description_code"] == "abc_A_xyz_X" and rec["strategy_code"] == "strategy_AX"


# ------------------------------------------------------------------ audit result + shared login limiter
def test_audit_result_is_recorded_and_failed_logins_are_audited(env):
    c = env["client"]
    from sqlalchemy import text as sql
    with env["Session"]() as s:  # a legacy row: written before the result column existed (NULL)
        s.execute(sql("INSERT INTO audit_logs (id, action, details, result, created_at) "
                      "VALUES ('legacy', 'product.update', 'old row', NULL, '2026-01-01 00:00:00')"))
        s.commit()
    assert c.post("/api/v1/auth/login", json={"email": "v1@dfios.com", "password": "wrong-1"}).status_code == 401
    logs = c.get("/api/v1/audit-logs?result=FAILURE", headers=env["admin"]).json()["items"]
    assert logs and logs[0]["action"] == "auth.login_failed" and logs[0]["result_source"] == "recorded"
    assert "wrong-1" not in (logs[0]["details"] or "")
    all_items = c.get("/api/v1/audit-logs?limit=50", headers=env["admin"]).json()["items"]
    old = next(x for x in all_items if x["id"] == "legacy")
    assert old["result"] == "unknown" and old["result_source"] == "legacy_unknown"


def test_login_budget_is_shared_through_the_database(env):
    from app.services.email_token_service import rate_limiter
    c = env["client"]
    for i in range(10):
        assert c.post("/api/v1/auth/login", json={"email": "m1@dfios.com", "password": f"bad{i}"}).status_code == 401
    with env["Session"]() as s:
        assert s.query(LoginFailure).filter(LoginFailure.key == "login_email:m1@dfios.com").count() == 10
    # another worker process has an EMPTY in-memory limiter: simulate it
    rate_limiter.clear("login_email:m1@dfios.com")
    for k in list(rate_limiter._requests):
        if "m1@dfios.com" in k:
            rate_limiter.clear(k)
    r = c.post("/api/v1/auth/login", json={"email": "m1@dfios.com", "password": "Passw0rd1"})
    assert r.status_code == 429
    with env["Session"]() as s:
        s.query(LoginFailure).delete()
        s.commit()
    rate_limiter.clear("login_email:m1@dfios.com")


# ------------------------------------------------------------------ Q-15 class_source provenance
def test_ground_truth_labels_are_verified(env, monkeypatch):
    from app.services.classification_service import classification_service
    with env["Session"]() as s:
        for it, seg in (("I1", "AX"), ("I2", "BY"), ("I3", "CZ")):
            s.add(SKUClassification(id=f"{it}_{STORE}", item_id=it, store_id=STORE, abc_class=seg[0],
                                    xyz_class=seg[1], segment=seg, class_source="ground_truth"))
        s.add(SKUClassification(id="I1_TX_1", item_id="I1", store_id="TX_1", abc_class="A", xyz_class="X",
                                segment="AX", class_source="ground_truth"))
        s.commit()
        mapping = {STORE: {"I1": "AX", "I2": "AZ"}}  # I2 differs, I3 missing; TX_1 has no mapping at all
        monkeypatch.setattr(classification_service, "_load_ground_truth_classes",
                            lambda store_id="CA_1": mapping.get(store_id, {}))
        # R5B-04: no mapping file on this machine -> nothing is relabelled
        monkeypatch.setattr(classification_service, "_ground_truth_file", lambda: None)
        assert classification_service.verify_ground_truth_labels(s) is None
        assert s.query(SKUClassification).filter(SKUClassification.class_source == "ground_truth").count() == 4
        monkeypatch.setattr(classification_service, "_ground_truth_file", lambda: "c3ok_sku_class.csv")
        assert classification_service.verify_ground_truth_labels(s) == 3
        got = {(r.item_id, r.store_id): r.class_source for r in s.query(SKUClassification)}
        assert got == {("I1", STORE): "ground_truth", ("I2", STORE): "legacy_unverified",
                       ("I3", STORE): "legacy_unverified", ("I1", "TX_1"): "legacy_unverified"}


def test_schema_default_of_class_source_is_not_ground_truth():
    col = SKUClassification.__table__.c.class_source
    assert col.server_default.arg == "legacy_unverified"


def _local_pg_url():
    url = os.getenv("DATABASE_URL", "")
    if not url.startswith("postgresql"):
        return None
    from urllib.parse import urlparse
    host = (urlparse(url.replace("+psycopg2", "")).hostname or "").lower()
    return url if host in ("localhost", "127.0.0.1", "::1") else None


@pytest.mark.skipif(_local_pg_url() is None, reason="needs a LOCAL PostgreSQL in DATABASE_URL (scratch schema)")
def test_postgres_upgrade_of_old_tables_never_claims_ground_truth(monkeypatch):
    """Old-schema tables in a throw-away schema: class_source added as legacy_unverified, the old 'ground_truth'
    default is replaced and verified, audit rows backfilled 'unknown'. The scratch schema is dropped afterwards."""
    from sqlalchemy import text as sql
    from app.core.schema_upgrades import apply_schema_upgrades
    from app.services.classification_service import classification_service
    schema = f"r5_upgrade_{os.getpid()}"
    admin = create_engine(_local_pg_url())
    with admin.begin() as conn:
        conn.execute(sql(f"CREATE SCHEMA {schema}"))
    eng = create_engine(_local_pg_url(), connect_args={"options": f"-csearch_path={schema}"})
    try:
        with eng.begin() as conn:
            conn.execute(sql("CREATE TABLE sku_classifications (id varchar PRIMARY KEY, item_id varchar NOT NULL, "
                             "abc_class varchar(1) NOT NULL, xyz_class varchar(1) NOT NULL, segment varchar(2) NOT NULL, "
                             "revenue float NOT NULL DEFAULT 0, revenue_share float NOT NULL DEFAULT 0, "
                             "cumulative_share float NOT NULL DEFAULT 0, mean_demand float NOT NULL DEFAULT 0, "
                             "std_demand float NOT NULL DEFAULT 0, cv float NOT NULL DEFAULT 0, updated_at timestamp NOT NULL)"))
            conn.execute(sql("CREATE UNIQUE INDEX ix_sku_classifications_item_id ON sku_classifications (item_id)"))
            conn.execute(sql("INSERT INTO sku_classifications (id, item_id, abc_class, xyz_class, segment, updated_at) "
                             "VALUES ('x', 'I1', 'A', 'X', 'AX', now())"))
            conn.execute(sql("CREATE TABLE audit_logs (id varchar PRIMARY KEY, actor_email varchar, action varchar NOT NULL, "
                             "ip_address varchar, details text, created_at timestamp NOT NULL)"))
            conn.execute(sql("INSERT INTO audit_logs (id, action, created_at) VALUES ('a', 'product.update', now())"))
        apply_schema_upgrades(eng)
        with eng.begin() as conn:
            assert conn.execute(sql("SELECT class_source FROM sku_classifications")).scalar() == "legacy_unverified"
            assert conn.execute(sql("SELECT result FROM audit_logs WHERE id = 'a'")).scalar() == "unknown"
            # a table upgraded by the OLD code (default 'ground_truth') is verified once
            conn.execute(sql("ALTER TABLE sku_classifications ALTER COLUMN class_source SET DEFAULT 'ground_truth'"))
            conn.execute(sql("UPDATE sku_classifications SET class_source = 'ground_truth'"))
        monkeypatch.setattr(classification_service, "_load_ground_truth_classes", lambda store_id="CA_1": {})
        # R5B-04: without the mapping file the check is deferred and nothing changes
        monkeypatch.setattr(classification_service, "_ground_truth_file", lambda: None)
        assert any("deferred" in a for a in apply_schema_upgrades(eng))
        with eng.begin() as conn:
            assert conn.execute(sql("SELECT class_source FROM sku_classifications")).scalar() == "ground_truth"
        monkeypatch.setattr(classification_service, "_ground_truth_file", lambda: "c3ok_sku_class.csv")
        applied = apply_schema_upgrades(eng)
        assert any("verified" in a for a in applied)
        with eng.begin() as conn:
            assert conn.execute(sql("SELECT class_source FROM sku_classifications")).scalar() == "legacy_unverified"
        assert not any("verified" in a for a in apply_schema_upgrades(eng))  # idempotent
    finally:
        eng.dispose()
        with admin.begin() as conn:
            conn.execute(sql(f"DROP SCHEMA {schema} CASCADE"))
        admin.dispose()


# ------------------------------------------------------------------ R-17 schedules
def test_listing_schedules_never_writes_and_deleting_all_stays_empty(env):
    from app.services.pipeline_service import pipeline_service
    c = env["client"]
    r = c.get("/api/v1/ml/schedule", headers=env["admin"])
    assert r.status_code == 200 and len(r.json()["items"]) == 1  # default shown
    with env["Session"]() as s:
        assert s.query(SystemSetting).filter(SystemSetting.key == "batch_pipeline_schedules").count() == 0
        assert pipeline_service.ensure_default_schedule(s) is True
        assert pipeline_service.ensure_default_schedule(s) is False
        pipeline_service._save_schedules_dict({}, db=s)
        assert pipeline_service._get_schedules_dict(s) == {}  # not resurrected


# ------------------------------------------------------------------ bootstrap pending proposals
def test_pending_proposals_are_rebuilt_from_the_current_state(env):
    from app.services.replenishment_service import replenishment_service
    with env["Session"]() as s:
        for it, oh in (("P1", 3.0), ("P2", 37.0)):
            s.add(Product(item_id=it, name=it, cat_id="FOODS", price=1.0))
            s.add(Inventory(item_id=it, store_id=STORE, on_hand=oh, on_order=0.0))
            s.add(InventoryParam(id=f"{STORE}_{it}", item_id=it, store_id=STORE, safety_stock=5.0, reorder_point=20.0,
                                 eoq=10.0, s=20.0, S=37.0))
        # provisional loader row computed from an OLD stock (IP 1 for P2) + a decided row that must survive
        s.add(ReplenishmentRecommendation(id="stale", item_id="P2", store_id=STORE, recommended_qty=36, final_qty=36,
                                          priority="HIGH", status="PENDING", inventory_position=1.0,
                                          created_at=datetime.now(timezone.utc)))
        s.add(ReplenishmentRecommendation(id="done", item_id="P2", store_id=STORE, recommended_qty=5, final_qty=5,
                                          priority="LOW", status="APPROVED", decided_by="a1@dfios.com",
                                          created_at=datetime.now(timezone.utc)))
        s.commit()
        res = replenishment_service.regenerate_pending_proposals(s, STORE, date(2016, 4, 25))
        assert res == {"removed": 1, "created": 1}
        pend = s.query(ReplenishmentRecommendation).filter(ReplenishmentRecommendation.status == "PENDING").all()
        assert [p.item_id for p in pend] == ["P1"]
        p = pend[0]
        inv = s.query(Inventory).filter(Inventory.item_id == "P1").one()
        assert p.inventory_position == inv.on_hand + inv.on_order == p.on_hand_at_review + p.on_order_at_review
        assert p.review_date == date(2016, 4, 25) and p.recommended_qty == p.order_up_to_S - p.inventory_position
        assert s.query(ReplenishmentRecommendation).filter(ReplenishmentRecommendation.id == "done").count() == 1


# ------------------------------------------------------------------ Q-17 coverage cache key
def test_coverage_cache_follows_replaced_quantiles(env):
    from app.services.coverage_service import db_causal_coverage_q95
    o = date(2016, 4, 25)
    with env["Session"]() as s:
        for d in range(10):
            s.add(SalesHistory(id=f"cv_{d}", item_id="I1", store_id=STORE, sale_date=o + timedelta(days=d),
                               quantity=2.0))
        s.add(ForecastWindowQuantile(id="w1", model_run_id="m", store_id=STORE, item_id="I1", origin_date=o,
                                     horizon_days=10, point_window=20.0, q_levels={"0.95": 25.0},
                                     created_at=datetime(2026, 1, 1, 0, 0, 0)))
        s.commit()
        assert db_causal_coverage_q95(s, STORE)["value"] == 1.0
        # same number of rows, new run with a LOWER quantile: the old key (store, row count) served 1.0 forever
        s.query(ForecastWindowQuantile).delete()
        s.add(ForecastWindowQuantile(id="w1", model_run_id="m", store_id=STORE, item_id="I1", origin_date=o,
                                     horizon_days=10, point_window=10.0, q_levels={"0.95": 15.0},
                                     created_at=datetime(2026, 1, 2, 0, 0, 0)))
        s.commit()
        assert db_causal_coverage_q95(s, STORE)["value"] == 0.0


# ------------------------------------------------------------------ J5: no invented price
def test_j5_excludes_items_without_a_price(env):
    from app.services.optimization_service import optimization_service
    with env["Session"]() as s:
        _seed_what_if(s)
        s.query(Product).filter(Product.item_id == ITEMS[0]).update({Product.price: 0.0})
        s.commit()
        scored = optimization_service.evaluate_class_candidates(s, STORE, "AX", O_IDX, 8, 0.95, [0.0], [1.0])
        assert scored is not None and scored[1] == 2  # 3 AX items, the one without price is excluded


# ------------------------------------------------------------------ repository hygiene / deprecations
def test_no_third_party_kaggle_calendar_in_the_repository():
    assert not os.path.exists(os.path.join(BE_DIR, "scripts", "sample_data", "calendar.csv"))


def test_no_deprecated_422_constant_or_class_config_in_app():
    pat = re.compile(r"HTTP_422_UNPROCESSABLE_ENTITY|^\s+class Config:", re.M)
    hits = []
    for root, _dirs, files in os.walk(os.path.join(BE_DIR, "app")):
        for f in files:
            if f.endswith(".py"):
                with open(os.path.join(root, f), encoding="utf-8") as fh:
                    if pat.search(fh.read()):
                        hits.append(f)
    assert hits == []


def test_compare_static_never_invents_demand(env):
    from app.services.optimization_service import optimization_service
    with env["Session"]() as s:
        s.add(SimClock(store_id=STORE, current_date=date(2016, 4, 25), start_date=date(2016, 4, 25)))
        for it, ann in (("Q1", None), ("Q2", 365.0)):
            s.add(Product(item_id=it, name=it, cat_id="FOODS", price=2.0))
            s.add(InventoryParam(id=f"{STORE}_{it}", item_id=it, store_id=STORE, safety_stock=1.0, reorder_point=5.0,
                                 eoq=3.0, s=5.0, S=8.0, annual_demand=ann))
        s.commit()
        res = optimization_service.compare_ml_vs_static(s, STORE)
        assert [i.item_id for i in res.items] == ["Q2"]  # Q1 has no demand at all: skipped, not 36.5 / year
        assert res.n_items_skipped == 1


# ------------------------------------------------------------------ user delete (FE round-5 finding)
def test_admin_can_delete_another_user(env):
    c, admin = env["client"], env["admin"]
    res = c.delete("/api/v1/users/v1", headers=admin)
    assert res.status_code == 200, res.text
    assert "v1@dfios.com" in res.json()["message"]
    with env["Session"]() as s:
        assert s.get(User, "v1") is None
    assert c.delete("/api/v1/users/v1", headers=admin).status_code == 404
    assert c.delete("/api/v1/users/a1", headers=admin).status_code == 400  # cannot delete self
    assert c.delete("/api/v1/users/m1", headers=env["manager"]).status_code == 403
    # R5F-01: lock and delete are audited
    assert c.patch("/api/v1/users/m1/status", json={"is_active": False}, headers=admin).status_code == 200
    actions = {x["action"] for x in c.get("/api/v1/audit-logs?limit=50", headers=admin).json()["items"]}
    assert {"admin.delete_user", "admin.lock_user"} <= actions


# ================================================================== ROUND 5 review follow-up (R5B-01 .. R5B-10)
def test_login_budget_reservation_is_atomic_under_a_parallel_burst():
    """R5B-01: 30 parallel reservations on one key -> exactly 10 pass (check and count in one step)."""
    import threading
    from app.services.email_token_service import InMemoryRateLimiter
    lim = InMemoryRateLimiter()
    got, barrier = [], threading.Barrier(30)

    def worker():
        barrier.wait()
        got.append(lim.reserve("login_email:x@dfios.com", 10, 300))

    ts = [threading.Thread(target=worker) for _ in range(30)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert sum(1 for g in got if g is not None) == 10


def test_db_login_budget_is_insert_then_count(env):
    from app.services.email_token_service import db_login_failures
    with env["Session"]() as s:
        res = [db_login_failures.reserve(s, "login_email:k@dfios.com", 300, 10)[0] for _ in range(12)]
        assert res == [True] * 10 + [False, False]
        assert s.query(LoginFailure).filter(LoginFailure.key == "login_email:k@dfios.com").count() == 10
        s.query(LoginFailure).delete()
        s.commit()


def test_inactive_and_throttled_logins_are_audited_and_unknown_emails_not_stored(env):
    from app.services.email_token_service import rate_limiter
    c = env["client"]
    with env["Session"]() as s:
        u = s.query(User).filter(User.id == "v1").one()
        u.is_active = False
        s.commit()
    try:
        # right password of a locked account: 403, audited, and it does NOT use the guessing budget
        for _ in range(12):
            assert c.post("/api/v1/auth/login", json={"email": "v1@dfios.com", "password": "Passw0rd1"}).status_code == 403
        assert c.post("/api/v1/auth/login", json={"email": "ghost@x.com", "password": "nope"}).status_code == 401
        logs = c.get("/api/v1/audit-logs?result=FAILURE&limit=50", headers=env["admin"]).json()["items"]
        assert any("inactive" in (x["details"] or "") for x in logs)
        unknown = [x for x in logs if "unknown_account" in (x["details"] or "")]
        assert unknown and all(not x.get("actor_email") for x in unknown)
        assert all("ghost@x.com" not in str(x) for x in logs)
    finally:
        for k in list(rate_limiter._requests):
            rate_limiter.clear(k)
        with env["Session"]() as s:
            s.query(LoginFailure).delete()
            s.commit()


def test_forced_sba_never_reads_sales_after_the_clock(env):
    c = env["client"]
    with env["Session"]() as s:
        _seed_store_sales(s, "NEW_3")
        s.add(SimClock(store_id="NEW_3", current_date=date(2016, 3, 20), start_date=date(2016, 3, 1)))
        s.add(Forecast(id="ens_x", item_id="SKU_A", store_id="NEW_3", forecast_date=date(2016, 3, 21), h=1,
                       y_pred=1.0, available=True, model_version="Ensemble-v1"))
        s.commit()
    d = c.post("/api/v1/forecast/fast-inference", json={"store_id": "NEW_3", "horizon": 7, "prefer_production": False},
               headers=env["admin"]).json()
    assert d["source"] == "sba_fallback" and d["history_end"] == "2016-03-20" and d["clock_date"] == "2016-03-20"
    assert "forced" in d["note"] and "has no production forecast" not in d["note"]


def test_what_if_current_policy_keeps_its_order_up_to_level_when_costs_change(env):
    """R5B-05: h and c re-price the stored ('current') policy; they do not redesign its S."""
    from app.services.what_if_service import what_if_service
    from app.schemas.simulation import WhatIfRequest
    with env["Session"]() as s:
        _seed_what_if(s)
        pol = [{"policy_key": "current", "use_current": True, "use_theta": False},
               {"policy_key": "p", "m_g": 0.0, "kappa_g": 1.0}]
        a = what_if_service.run(s, WhatIfRequest(store_id=STORE, n_reviews=8, classes=["AX"], policies=pol))
        b = what_if_service.run(s, WhatIfRequest(store_id=STORE, n_reviews=8, classes=["AX"], policies=pol,
                                                 holding_rate=0.02, order_cost=0.0))
        assert a.policies[0].overall.orders == b.policies[0].overall.orders
        assert a.policies[0].overall.holding_cost != b.policies[0].overall.holding_cost
        assert a.policies[1].overall.orders != b.policies[1].overall.orders  # a requested policy uses the new EOQ
        # no stored selection -> the default is reported, never silent
        assert a.policies[0].by_class[0].params_source == "default_no_stored_selection"
        assert any("No stored policy selection" in n for n in a.notes)


def test_gaussian_fallback_z_is_exact_for_any_tau():
    from app.services.window_quantile_service import gaussian_z
    assert gaussian_z(0.95) == 1.645
    assert gaussian_z(0.92) == pytest.approx(1.405, abs=1e-3)


def test_what_if_refuses_placeholder_prices(env):
    c = env["client"]
    with env["Session"]() as s:
        _seed_what_if(s)
        s.query(Product).update({Product.price: 1.0})
        s.commit()
    r = c.post("/api/v1/simulation/what-if", json={"store_id": STORE}, headers=env["admin"])
    assert r.status_code == 422 and r.json()["detail"]["reason_code"] == "placeholder_prices"


def test_compare_policies_what_if_follows_the_store_and_survives_a_missing_artifact(env, monkeypatch):
    from fastapi import HTTPException
    from app.services.simulation_service import simulation_service
    c = env["client"]
    with env["Session"]() as s:
        _seed_what_if(s)

    def missing(**kw):
        raise HTTPException(status_code=503, detail="c3ok_results.csv missing")

    monkeypatch.setattr(simulation_service, "compare_policies", missing)
    body = {"store_id": STORE, "what_if": {"n_reviews": 8, "classes": ["AX"]}}
    r = c.post("/api/v1/simulation/compare-policies", json=body, headers=env["admin"])
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "artifact_missing" and d["what_if"]["store_id"] == STORE
    bad = {"store_id": STORE, "what_if": {"store_id": "TX_1"}}
    r2 = c.post("/api/v1/simulation/compare-policies", json=bad, headers=env["admin"])
    assert r2.status_code == 422 and r2.json()["detail"]["reason_code"] == "store_mismatch"
    assert c.post("/api/v1/simulation/compare-policies", json={"store_id": STORE},
                  headers=env["admin"]).status_code == 503


def test_local_only_guard_accepts_sqlite_and_rejects_remote(monkeypatch):
    from app.core import config
    monkeypatch.setenv("DFIOS_LOCAL_ONLY", "1")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///./x.db")
    config._assert_local_only()
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg2://u:p@db.example.com:5432/postgres")
    with pytest.raises(RuntimeError):
        config._assert_local_only()


def test_schema_reconcile_relaxes_only_explicitly_nullable_columns():
    """R5B-10: an ORM column without nullable= keeps the NOT NULL of an existing database."""
    from app.models import Base as AllBase
    t = AllBase.metadata.tables
    assert t["policy_selection"].c.val_cost._user_defined_nullable is True
    assert t["sim_clock"].c.mode._user_defined_nullable is not True


def test_replenishment_reason_says_ip_at_or_below_s():
    src = open(os.path.join(BE_DIR, "app", "services", "replenishment_service.py"), encoding="utf-8").read()
    assert "IP ({ip:.1f}) ≤ s" in src
