"""
G-48 Inventory Management screen and G-49 Forecast Explorer window panel. Tiny SQLite panels only.
"""
import math
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
from app.models.base import Base
from app.models.calibration_state import CalibrationState
from app.models.classification import SKUClassification
from app.models.forecast_backtest import ForecastBacktest
from app.models.inventory import Inventory
from app.models.inventory_param import InventoryParam
from app.models.policy_selection import PolicySelection
from app.models.product import Product
from app.models.replenishment import ReplenishmentRecommendation
from app.models.sales_history import SalesHistory
from app.models.sim_clock import SimClock
from app.models.user import User
from app.services import policy_config as pc
from app.services.forecast_explorer_service import window_error_stats

CLOCK = date(2016, 4, 25)
STORE = "CA_1"


def _session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)


@pytest.fixture()
def client_db():
    Session = _session()

    def override():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
    db = Session()
    db.add(User(id="v1", email="viewer@dfios.com", password_hash=get_password_hash("Viewer123"), role="Viewer",
                display_name="Viewer", is_active=True, is_verified=True, token_version=1))
    db.add(SimClock(store_id=STORE, current_date=CLOCK, start_date=CLOCK))
    db.commit()
    token = create_access_token(data={"sub": "viewer@dfios.com", "role": "Viewer", "user_id": "v1",
                                      "token_version": 1})
    client = TestClient(app)
    client.headers.update({"Authorization": f"Bearer {token}"})
    yield client, db
    db.close()
    app.dependency_overrides.pop(get_db, None)


# ---------------------------------------------------------------------------------------------
# G-48 Inventory Management
# ---------------------------------------------------------------------------------------------
def _inventory_panel(db):
    """4 SKUs: below s, ok, above S, no params; 7 days of sales before the clock."""
    spec = [  # item, price, on_hand, on_order, s, S, segment, daily sales
        ("A_BELOW", 2.0, 3.0, 1.0, 10.0, 20.0, "AX", 2.0),
        ("B_OK", 5.0, 12.0, 0.0, 10.0, 20.0, "BY", 1.0),
        ("C_ABOVE", 1.0, 30.0, 5.0, 10.0, 20.0, "CZ", 0.0),
        ("D_NOPARAM", 4.0, 7.0, 0.0, None, None, None, 1.0),
    ]
    for item, price, oh, oo, s, S, seg, d in spec:
        db.add(Product(item_id=item, name=f"Name {item}", cat_id="FOODS", dept_id="FOODS_1", price=price))
        db.add(Inventory(item_id=item, store_id=STORE, on_hand=oh, on_order=oo))
        if s is not None:
            db.add(InventoryParam(id=f"{STORE}_{item}", item_id=item, store_id=STORE, s=s, S=S, safety_stock=4.0,
                                  eoq=7.0, source="ml", model_run_id="REFIT-RSS-EOQ-G"))
        if seg:
            db.add(SKUClassification(id=f"c_{item}", item_id=item, store_id=STORE, abc_class=seg[0],
                                     xyz_class=seg[1], segment=seg, class_source="ground_truth"))
        for k in range(1, 8):
            db.add(SalesHistory(id=f"{item}_{k}", item_id=item, store_id=STORE,
                                sale_date=CLOCK - timedelta(days=k), quantity=d))
    # other store: must never leak in
    db.add(Inventory(item_id="A_BELOW", store_id="TX_1", on_hand=999.0, on_order=0.0))
    t0 = datetime(2016, 4, 1, tzinfo=timezone.utc)
    db.add(ReplenishmentRecommendation(id="r_old", item_id="A_BELOW", store_id=STORE, recommended_qty=5,
                                       final_qty=5, status="COMPLETED", created_at=t0,
                                       review_date=date(2016, 4, 1)))
    db.add(ReplenishmentRecommendation(id="r_new", item_id="A_BELOW", store_id=STORE, recommended_qty=16,
                                       final_qty=16, status="APPROVED", created_at=t0 + timedelta(days=20),
                                       review_date=date(2016, 4, 21)))
    db.add(ReplenishmentRecommendation(id="r_tx", item_id="A_BELOW", store_id="TX_1", recommended_qty=1,
                                       final_qty=1, status="APPROVED", created_at=t0))
    db.commit()


def test_inventory_screen_rows_status_cover_and_summary(client_db):
    client, db = client_db
    _inventory_panel(db)
    r = client.get("/api/v1/inventory-screen", params={"store_id": STORE})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 4 and body["as_of"] == str(CLOCK) and body["as_of_source"] == "sim_clock"
    rows = {x["item_id"]: x for x in body["items"]}
    a = rows["A_BELOW"]
    assert a["ip"] == 4.0 and a["stock_status"] == "below_s" and a["segment"] == "AX"
    assert a["mean_daily_demand"] == 2.0 and a["days_of_cover"] == 1.5  # on_hand 3 / 2 per day
    assert a["latest_recommendation"]["id"] == "r_new" and a["latest_recommendation"]["status"] == "APPROVED"
    assert a["cold_start"] is True  # no forecast / backtest / teacher window rows in this panel
    assert rows["B_OK"]["stock_status"] == "ok" and rows["B_OK"]["days_of_cover"] == 12.0
    assert rows["C_ABOVE"]["stock_status"] == "above_S" and rows["C_ABOVE"]["days_of_cover"] is None
    d = rows["D_NOPARAM"]
    assert d["stock_status"] == "no_params" and d["s"] is None and d["segment"] is None
    s = body["summary"]
    assert s["sku_count"] == 4 and s["below_s_count"] == 1 and s["above_S_count"] == 1
    assert s["no_params_count"] == 1
    assert s["total_stock_value"] == pytest.approx(3 * 2.0 + 12 * 5.0 + 30 * 1.0 + 7 * 4.0)
    assert s["units_in_transit"] == 6.0 and s["skus_in_transit"] == 2 and s["orders_in_transit"] == 1


def test_inventory_screen_filters_sort_and_pagination(client_db):
    client, db = client_db
    _inventory_panel(db)
    def get(**p):
        return client.get("/api/v1/inventory-screen", params={"store_id": STORE, **p}).json()

    assert [x["item_id"] for x in get(status="below_s")["items"]] == ["A_BELOW"]
    assert [x["item_id"] for x in get(**{"class": "B"})["items"]] == ["B_OK"]
    assert [x["item_id"] for x in get(**{"class": "CZ"})["items"]] == ["C_ABOVE"]
    assert [x["item_id"] for x in get(**{"class": "NONE"})["items"]] == ["D_NOPARAM"]
    assert [x["item_id"] for x in get(search="name b_")["items"]] == ["B_OK"]
    by_ip = get(sort_by="ip", sort_dir="desc")
    assert [x["item_id"] for x in by_ip["items"]] == ["C_ABOVE", "B_OK", "D_NOPARAM", "A_BELOW"]
    cover = get(sort_by="days_of_cover", sort_dir="asc")["items"]
    assert [x["item_id"] for x in cover] == ["A_BELOW", "D_NOPARAM", "B_OK", "C_ABOVE"]  # None last
    page2 = get(sort_by="item_id", skip=2, limit=2)
    assert page2["total"] == 4 and [x["item_id"] for x in page2["items"]] == ["C_ABOVE", "D_NOPARAM"]
    filtered = get(status="ok", limit=1)
    assert filtered["total"] == 1 and filtered["summary"]["sku_count"] == 4  # summary is store-wide


def test_inventory_screen_rejects_bad_input(client_db):
    client, _db = client_db
    assert client.get("/api/v1/inventory-screen", params={"store_id": "GLOBAL"}).status_code == 422
    assert client.get("/api/v1/inventory-screen", params={"store_id": STORE, "status": "x"}).status_code == 422
    assert client.get("/api/v1/inventory-screen", params={"store_id": STORE, "sort_by": "x"}).status_code == 422
    assert client.get("/api/v1/inventory-screen", params={"store_id": STORE, "class": "Q"}).status_code == 422
    assert TestClient(app).get("/api/v1/inventory-screen", params={"store_id": STORE}).status_code == 401


def test_inventory_screen_unknown_demand_is_not_zero(client_db):
    client, db = client_db
    db.add(Product(item_id="X", name="X", price=1.0))
    db.add(Inventory(item_id="X", store_id=STORE, on_hand=5.0, on_order=0.0))
    db.commit()
    body = client.get("/api/v1/inventory-screen", params={"store_id": STORE}).json()
    assert body["demand_days_observed"] == 0
    assert body["items"][0]["mean_daily_demand"] is None and body["items"][0]["days_of_cover"] is None


# ---------------------------------------------------------------------------------------------
# G-49 Forecast Explorer window
# ---------------------------------------------------------------------------------------------
def test_window_error_stats_hand_computed():
    """Daily demand y = 1,2,3,4,5,6,7 repeated (weekly season) -> SNaive is exact; H = 2."""
    first = 0
    y = np.array([float((k % 7) + 1) for k in range(80)])
    H = 2
    origins = [40, 47]
    model = {40: y[40] + y[41] + 1.0, 47: y[47] + y[48] - 1.0}  # errors +1 and -1
    st = window_error_stats(y, first, origins, model, H, review_idx=60, lookback_days=30)
    m = {x.method: x for x in st.methods}
    assert st.n_windows == 2 and st.reason_code == "no_mase_scale"
    assert m["snaive"].mae == 0.0 and m["snaive"].bias == 0.0
    assert m["model"].mae == 1.0 and m["model"].bias == 0.0
    # scale = H * mean |y_t - y_(t-7)| = 0 for a pure weekly pattern -> MASE undefined
    assert st.scale is None and m["model"].mase is None


def test_window_error_stats_scale_naive_ma_and_causality():
    rng = np.random.default_rng(0)
    y = rng.integers(0, 6, size=120).astype(float)
    H = 3
    model = {o: float(y[o:o + H].sum()) + 2.0 for o in (60, 70, 80, 95)}
    st = window_error_stats(y, 0, list(model), model, H, review_idx=97, lookback_days=40)
    # origin 95 ends at 98 > review 97 -> excluded (no future actuals)
    assert st.n_windows == 3 and st.last_origin == pc.day_index_to_date(80)
    diffs = [abs(y[i] - y[i - 7]) for i in range(7, 60)]
    assert st.scale == pytest.approx(round(H * float(np.mean(diffs)), 4))
    m = {x.method: x for x in st.methods}
    assert m["model"].bias == 2.0 and m["model"].mae == 2.0
    assert m["model"].mase == pytest.approx(round(2.0 / (H * float(np.mean(diffs))), 4), abs=1e-4)
    naive_err = [H * y[o - 1] - y[o:o + H].sum() for o in (60, 70, 80)]
    assert m["naive"].bias == pytest.approx(round(float(np.mean(naive_err)), 4))
    ma_err = [H * y[o - 28:o].mean() - y[o:o + H].sum() for o in (60, 70, 80)]
    assert m["ma28"].mae == pytest.approx(round(float(np.mean(np.abs(ma_err))), 4))
    # a missing actual day drops the window, never counted as 0
    y2 = y.copy()
    y2[61] = np.nan
    assert window_error_stats(y2, 0, list(model), model, H, 97, 40).n_windows == 2
    empty = window_error_stats(y, 0, [], {}, H, 97, 40)
    assert empty.reason_code == "no_model_windows" and empty.methods[0].mae is None


def _window_panel(db):
    item = "FOODS_1_001"
    db.add(Product(item_id=item, name="Item", cat_id="FOODS", dept_id="FOODS_1", price=4.0))
    db.add(SKUClassification(id="c1", item_id=item, store_id=STORE, abc_class="C", xyz_class="Z", segment="CZ",
                             class_source="ground_truth"))
    db.add(PolicySelection(selection_id="sel_global", class_id="CZ", m_g=0.2, kappa_g=1.5, source="j5_backtest"))
    db.add(CalibrationState(id="cs1", calibrator_id="c3", store_id=STORE, class_id="CZ", review_index=1,
                            review_date=CLOCK - timedelta(days=7), theta=0.1))
    db.add(InventoryParam(id=f"{STORE}_{item}", item_id=item, store_id=STORE, s=11.0, S=19.0, source="ml",
                          model_run_id="REFIT-RSS-EOQ-G"))
    o = pc.date_to_day_index(CLOCK)
    rng = np.random.default_rng(1)
    for k in range(1, 400):
        db.add(SalesHistory(id=f"s{k}", item_id=item, store_id=STORE, sale_date=CLOCK - timedelta(days=k),
                            quantity=float(rng.integers(0, 5))))
    for j, r in enumerate(range(o - 364, o - 9, 7)):  # weekly backtest reviews, window sum of 10 days
        db.add(ForecastBacktest(id=f"bt{j}", store_id=STORE, item_id=item, review_day=r, dhat=20.0 + (j % 3),
                                dhat_lgb=20.0, sigma_d=1.0))
    db.commit()
    return item


def test_forecast_explorer_window_endpoint(client_db):
    client, db = client_db
    item = _window_panel(db)
    r = client.get("/api/v1/forecast-explorer/window", params={"store_id": STORE, "item_id": item})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["review_date"] == str(CLOCK) and b["review_date_source"] == "sim_clock" and b["horizon_days"] == 10
    d = b["distribution"]
    assert d["stored"] is False and d["route"] == "c" and d["n_residuals"] > 8
    assert d["point_source"] == "backtest"
    qs = [d["q_min"], d["q50"], d["q80"], d["q90"], d["q95"], d["q99"]]
    assert all(q is not None for q in qs) and qs == sorted(qs) and d["min_level"] == 0.05
    st = b["error_stats"]
    assert st["model_source"] == "forecast_backtest" and st["n_windows"] > 10 and st["reason_code"] is None
    assert {m["method"] for m in st["methods"]} == {"model", "snaive", "naive", "ma28"}
    assert all(m["mase"] is not None for m in st["methods"])
    p = b["policy"]
    assert p["segment"] == "CZ" and p["m_g"] == 0.2 and p["kappa_g"] == 1.5 and p["theta_g"] == 0.1
    assert p["s"] == math.ceil(p["q_hat_tau"] * math.exp(0.3) - 1e-9)
    assert p["eoq"] == pytest.approx(math.sqrt(2 * pc.ORDER_COST_C * p["mean_daily_56"] / (pc.HOLDING_RATE_DAILY * 4.0)),
                                     abs=1e-3)
    assert p["S"] == p["s"] + math.ceil(1.5 * p["eoq"] - 1e-9)
    assert p["stored_s"] == 11.0 and p["stored_S"] == 19.0
    # GET never writes window-quantile rows
    from app.models.forecast_window_quantile import ForecastWindowQuantile
    assert db.query(ForecastWindowQuantile).count() == 0


def test_forecast_explorer_window_errors(client_db):
    client, db = client_db
    item = _window_panel(db)
    url = "/api/v1/forecast-explorer/window"
    assert client.get(url, params={"store_id": STORE, "item_id": "NOPE"}).status_code == 404
    assert client.get(url, params={"store_id": "ALL", "item_id": item}).status_code == 422
    future = str(CLOCK + timedelta(days=1))
    assert client.get(url, params={"store_id": STORE, "item_id": item, "review_date": future}).status_code == 422
    past = client.get(url, params={"store_id": STORE, "item_id": item, "review_date": str(CLOCK - timedelta(days=70))})
    assert past.status_code == 200 and past.json()["review_date_source"] == "request"
    # theta of a calibration state dated after the requested review date is not used
    assert past.json()["policy"]["theta_g"] == 0.0


def test_inventory_screen_values_stock_at_the_clock_date_price(client_db):
    """G-37: the screen and the dashboard KPI show ONE stock value: end-of-day stock x price of the clock date
    (price_history), else products.price."""
    from app.models.price_history import PriceHistory

    client, db = client_db
    _inventory_panel(db)
    db.add(PriceHistory(store_id=STORE, item_id="B_OK", date=CLOCK, price=6.0))  # 5.0 constant, 6.0 that day
    db.add(PriceHistory(store_id=STORE, item_id="C_ABOVE", date=CLOCK - timedelta(days=1), price=9.0))  # not today
    db.commit()
    body = client.get("/api/v1/inventory-screen", params={"store_id": STORE}).json()
    rows = {x["item_id"]: x for x in body["items"]}
    assert rows["B_OK"]["price"] == 6.0 and rows["B_OK"]["stock_value"] == pytest.approx(12 * 6.0)
    assert rows["C_ABOVE"]["price"] == 1.0
    assert body["summary"]["total_stock_value"] == pytest.approx(3 * 2.0 + 12 * 6.0 + 30 * 1.0 + 7 * 4.0)
    kpi = client.get("/api/v1/dashboard/kpis", params={"store_id": STORE}).json()
    assert kpi["total_inventory_value"] == pytest.approx(body["summary"]["total_stock_value"])
    by_value = client.get("/api/v1/inventory-screen",
                          params={"store_id": STORE, "sort_by": "stock_value", "sort_dir": "desc"}).json()
    assert by_value["items"][0]["item_id"] == "B_OK"


def test_dashboard_reorder_count_is_the_j4_trigger_ip_below_s(client_db):
    """The dashboard 'SKU at the reorder point' count is IP < s (strict, the J4 trigger), the same number as the
    Inventory screen 'below s': an SKU with IP == s is not ordered."""
    client, db = client_db
    _inventory_panel(db)
    db.add(Product(item_id="E_EQUAL", name="E", cat_id="FOODS", dept_id="FOODS_1", price=1.0))
    db.add(Inventory(item_id="E_EQUAL", store_id=STORE, on_hand=10.0, on_order=0.0))
    db.add(InventoryParam(id=f"{STORE}_E_EQUAL", item_id="E_EQUAL", store_id=STORE, s=10.0, S=20.0,
                          reorder_point=10.0, safety_stock=4.0, eoq=7.0))
    for row in db.query(InventoryParam).filter(InventoryParam.s.is_not(None)).all():
        row.reorder_point = row.s
    db.commit()
    kpi = client.get("/api/v1/dashboard/kpis", params={"store_id": STORE}).json()
    screen = client.get("/api/v1/inventory-screen", params={"store_id": STORE}).json()
    assert kpi["reorder_alerts_count"] == screen["summary"]["below_s_count"] == 1  # A_BELOW only
    alerts = client.get("/api/v1/dashboard/alerts", params={"store_id": STORE, "limit": 50}).json()
    sev = {x["item_id"]: x["severity"] for x in alerts["items"]}
    assert sev["E_EQUAL"] == "HEALTHY" and sev["A_BELOW"] in ("CRITICAL", "WARNING")
