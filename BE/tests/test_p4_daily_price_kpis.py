# ruff: noqa: F811  (pytest fixture imported from test_round5_fixes)
"""G-37 follow-up: the KPI consumers (dashboard costs, reports, simulation basis, what-if) value every quantity at the
price of ITS date via price_history_repository; with no price_history row they return exactly the constant-price
numbers of before."""
from datetime import date, timedelta

import numpy as np
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.classification import SKUClassification
from app.models.forecast import Forecast
from app.models.inventory import Inventory
from app.models.inventory_daily import InventoryDaily
from app.models.price_history import PriceHistory
from app.models.product import Product
from app.models.sales_history import SalesHistory
from app.models.service_outcomes import ServiceOutcome
from app.models.sim_clock import SimClock
from app.models.sim_state import SimShadowDaily
from app.repositories.reports_repository import reports_repository
from app.services import policy_backtest
from app.services import policy_config as pc
from app.services.dashboard_service import DashboardService, valued_stock_sums
from app.services.simulation_service import SimulationService

from tests.test_round5_fixes import ITEMS, O_IDX, STORE, _seed_what_if, env  # noqa: F401  (fixture)

D0 = date(2016, 4, 25)
D1, D2 = D0 + timedelta(days=1), D0 + timedelta(days=2)
F, H = "FOODS_1_001", "HOBBIES_1_001"
h, b = pc.HOLDING_RATE_DAILY, pc.STOCKOUT_PENALTY_RATE

# (on_hand_end, lost_sales) per day D0, D1, D2
C3 = {F: [(4, 0), (0, 2), (3, 0)], H: [(1, 0), (1, 0), (2, 1)]}
B0 = {F: [(6, 0), (5, 0), (4, 0)], H: [(0, 1), (2, 0), (2, 0)]}
DAILY_PRICES = [(F, D0, 2.5), (F, D1, 3.0), (H, D2, 6.0)]   # F on D2 and H on D0, D1 fall back to products.price


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine, expire_on_commit=False)()
    s.add(SimClock(store_id="CA_1", start_date=D0, current_date=D2))
    s.add(Product(item_id=F, name=F, cat_id="FOODS", price=2.0))
    s.add(Product(item_id=H, name=H, cat_id="HOBBIES", price=5.0))
    s.add(Inventory(item_id=F, store_id="CA_1", on_hand=3.0, on_order=0.0))
    s.add(Inventory(item_id=H, store_id="CA_1", on_hand=2.0, on_order=0.0))
    for it in (F, H):
        s.add(SKUClassification(id=f"c_{it}", item_id=it, store_id="CA_1", abc_class="A", xyz_class="X",
                                segment="AX"))
        for k, d in enumerate((D0, D1, D2)):
            oh, ls = C3[it][k]
            s.add(InventoryDaily(store_id="CA_1", item_id=it, date=d, on_hand_end=oh, lost_sales=ls, sales=0.0))
            oh, ls = B0[it][k]
            s.add(SimShadowDaily(store_id="CA_1", item_id=it, date=d, on_hand_end=oh, lost_sales=ls, sales=0.0,
                                 order_qty=0.0))
    s.add(ServiceOutcome(id="so0", calibrator_id="c", store_id="CA_1", class_id="AX", cycle_index=0,
                         cycle_start=D0, cycle_end=D2, n_sku=2, n_stockout=1))
    s.commit()
    yield s
    s.close()
    Base.metadata.drop_all(bind=engine)


def _add_prices(s):
    s.add_all([PriceHistory(store_id="CA_1", item_id=i, date=d, price=p) for i, d, p in DAILY_PRICES])
    s.add(PriceHistory(store_id="TX_1", item_id=F, date=D0, price=99.0))   # another store: never used for CA_1
    s.commit()


# ------------------------------------------------------------------ (a) no price_history: constant-price numbers
def test_no_price_history_gives_the_constant_price_numbers(db):
    daily = DashboardService._daily_costs(db, InventoryDaily, ["CA_1"], D0, D2)
    assert daily[D0] == pytest.approx(((4 * 2 + 1 * 5) * h, 0.0))
    assert daily[D1] == pytest.approx(((0 * 2 + 1 * 5) * h, 2 * 2 * b))
    assert daily[D2] == pytest.approx(((3 * 2 + 2 * 5) * h, 1 * 5 * b))
    sh = DashboardService._daily_costs(db, SimShadowDaily, ["CA_1"], D0, D2)
    assert sh[D0] == pytest.approx((12 * h, 5 * b))

    cc = reports_repository.get_cost_comparison_report(db, "CA_1")
    ml = cc["ml_policy"]
    assert ml["holding_cost"] == round((14 + 20) * h, 2) and ml["stockout_penalty_cost"] == round((4 + 5) * b, 2)
    foods = reports_repository.get_cost_comparison_report(db, "CA_1", category="FOODS")["ml_policy"]
    assert foods["stockout_penalty_cost"] == round(4 * b, 2)

    bt = reports_repository.run_historical_backtest(db, store_id="CA_1")
    assert bt["holding_cost_savings"] == round((50 - 34) * h, 2)
    assert valued_stock_sums(db, InventoryDaily, ["CA_1"], D0, D2, by=None)[None] == pytest.approx((34.0, 9.0))

    inv = reports_repository.get_inventory_performance_report(db, "CA_1")
    assert inv["total_inventory_value"] == 3 * 2 + 2 * 5 and inv["price_valuation_dates"] == {}

    assert SimulationService._store_basis(db, "CA_1") == (2, pytest.approx(3.5), "products.price")


# ------------------------------------------------------------------ (b) daily prices, hand-computed
def test_daily_prices_value_holding_lost_and_stock_at_the_price_of_the_day(db):
    _add_prices(db)
    daily = DashboardService._daily_costs(db, InventoryDaily, ["CA_1"], D0, D2)
    assert daily[D0] == pytest.approx(((4 * 2.5 + 1 * 5) * h, 0.0))
    assert daily[D1] == pytest.approx(((0 * 3.0 + 1 * 5) * h, 2 * 3.0 * b))
    assert daily[D2] == pytest.approx(((3 * 2.0 + 2 * 6.0) * h, 1 * 6.0 * b))
    sh = DashboardService._daily_costs(db, SimShadowDaily, ["CA_1"], D0, D2)
    assert sh[D1] == pytest.approx(((5 * 3.0 + 2 * 5) * h, 0.0))

    cc = reports_repository.get_cost_comparison_report(db, "CA_1")
    # C3 holding: FOODS 4*2.5 + 0*3 + 3*2 = 16, HOBBIES 1*5 + 1*5 + 2*6 = 22; lost: FOODS 2*3 = 6, HOBBIES 1*6 = 6
    assert cc["ml_policy"]["holding_cost"] == round(38 * h, 2)
    assert cc["ml_policy"]["stockout_penalty_cost"] == round(12 * b, 2)
    # B0 holding: FOODS 6*2.5 + 5*3 + 4*2 = 38, HOBBIES 0 + 2*5 + 2*6 = 22; lost: HOBBIES 1*5 (D0 fallback)
    assert cc["baseline_policy"]["holding_cost"] == round(60 * h, 2)
    assert cc["baseline_policy"]["stockout_penalty_cost"] == round(5 * b, 2)
    hob = reports_repository.get_cost_comparison_report(db, "CA_1", category="HOBBIES")["ml_policy"]
    assert hob["holding_cost"] == round(22 * h, 2) and hob["stockout_penalty_cost"] == round(6 * b, 2)

    bt = reports_repository.run_historical_backtest(db, store_id="CA_1")
    assert bt["holding_cost_savings"] == round((60 - 38) * h, 2)

    # stock valued at the price of the clock date D2: F 3 * 2.0 (fallback), H 2 * 6.0
    inv = reports_repository.get_inventory_performance_report(db, "CA_1")
    assert inv["total_inventory_value"] == 3 * 2.0 + 2 * 6.0
    assert inv["price_valuation_dates"] == {"CA_1": str(D2)}
    assert {i["item_id"]: i["inventory_value"] for i in inv["items"]} == {F: 6.0, H: 12.0}

    assert SimulationService._store_basis(db, "CA_1") == (2, pytest.approx(4.0), f"price_history@{D2}")


def _seed_accuracy(s):
    """F history 1..5 (naive diff 1), H history 2,0,2,0,2 (diff 2); eval 2 days, F err -2, H err -1.
    rmsse = mase: F 2.0, H 0.5."""
    for it, hist, act, pred in ((F, [1, 2, 3, 4, 5], 5.0, 3.0), (H, [2, 0, 2, 0, 2], 2.0, 1.0)):
        for k, q in enumerate(hist):
            d = D0 - timedelta(days=5 - k)
            s.add(SalesHistory(id=f"h_{it}_{k}", item_id=it, store_id="CA_1", sale_date=d, quantity=float(q)))
        for k, d in enumerate((D0, D1)):
            s.add(SalesHistory(id=f"e_{it}_{k}", item_id=it, store_id="CA_1", sale_date=d, quantity=act))
            s.add(Forecast(id=f"f_{it}_{k}", item_id=it, store_id="CA_1", forecast_date=d, h=1, y_pred=pred,
                              available=True, model_version="test"))
    s.commit()


def test_wrmsse_weights_are_28_day_dollar_sales_at_daily_prices(db):
    _seed_accuracy(db)
    const = reports_repository.get_forecast_accuracy_report(db, store_id="CA_1")["overall_metrics"]
    # dollars F 15 * 2 = 30, H 6 * 5 = 30 -> equal weights
    assert const["wrmsse"] == pytest.approx(round(0.5 * 2.0 + 0.5 * 0.5, 4))
    assert const["mase"] == const["wrmsse"]
    # F sold at 4.0 on its 5 history days (60 $), H keeps products.price (30 $) -> weights 2/3, 1/3
    db.add_all([PriceHistory(store_id="CA_1", item_id=F, date=D0 - timedelta(days=j), price=4.0)
                for j in range(1, 6)])
    db.commit()
    daily = reports_repository.get_forecast_accuracy_report(db, store_id="CA_1")["overall_metrics"]
    assert daily["wrmsse"] == pytest.approx(round(2 / 3 * 2.0 + 1 / 3 * 0.5, 4))
    # the eval-window MAE / RMSE are price free
    assert (daily["mae"], daily["rmse"]) == (const["mae"], const["rmse"])


# ------------------------------------------------------------------ (c) what-if = engine with daily prices
def _price_of(n: int, d: int) -> float:
    return 3.0 + 0.5 * ((d + n) % 4)


def test_what_if_cost_equals_the_engine_with_daily_prices(env):
    from app.schemas.simulation import WhatIfRequest
    from app.services.what_if_service import what_if_service

    req = WhatIfRequest(store_id=STORE, n_reviews=8, classes=["AX"],
                        policies=[{"policy_key": "p", "m_g": 0.1, "kappa_g": 1.5}])
    with env["Session"]() as s:
        _seed_what_if(s)
        const_res = what_if_service.run(s, req).policies[0].by_class[0]
        const, _ = what_if_service._class_inputs(s, STORE, "AX", O_IDX, 8, 0.95, 3, 7, 0.002, 2.0)
        assert np.all(const["daily_price"] == 4.0)   # no price_history: products.price on every day

        rows = [PriceHistory(store_id=STORE, item_id=it, date=pc.day_index_to_date(d), price=_price_of(n, d))
                for n, it in enumerate(ITEMS) for d in range(O_IDX - 120, O_IDX)]
        s.add_all(rows)
        s.commit()
        res = what_if_service.run(s, req).policies[0].by_class[0]
        data, _ = what_if_service._class_inputs(s, STORE, "AX", O_IDX, 8, 0.95, 3, 7, 0.002, 2.0)

        reviews, R = data["reviews"], 7
        days = [r + j for r in reviews for j in range(R)]
        expect = np.array([[_price_of(n, d) for d in days] for n in range(3)])   # AX = first 3 items
        np.testing.assert_array_equal(data["daily_price"], expect)
        # EOQ of review k at the review-day price (point forecast unchanged): EOQ ∝ 1 / sqrt(price)
        p_rev = expect[:, [k * R for k in range(len(reviews))]]
        np.testing.assert_allclose(data["eoq"], const["eoq"] * np.sqrt(4.0 / p_rev))

        eng = policy_backtest.simulate_rss_candidates(
            data["dem"], data["q"], data["eoq"], data["price"], [0.1], [1.5], initial_on_hand=data["init"],
            daily_price=data["daily_price"])
        assert res.total_cost == pytest.approx(round(float(eng.cost[0]), 2))
        assert res.holding_cost == pytest.approx(round(float(eng.holding[0]), 2))
        assert res.shortage_cost == pytest.approx(round(float(eng.shortage[0]), 2))
        assert res.availability == pytest.approx(round(float(eng.availability[0]), 5))
        # and it is not the constant-price figure
        assert res.total_cost != pytest.approx(const_res.total_cost)
