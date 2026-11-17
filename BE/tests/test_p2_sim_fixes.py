"""
P2 simulator fixes (sandbox run report, docs/sandbox_run_report.md section 4):
  1. the start date t0 is a fully simulated day (teacher rss.py / replay_e10b: arrivals -> review if
     (t - t0) % R == 0 -> demand -> holding on end-of-day stock, from t0 included);
  2. reset() drops the store's J5 refit selections ``<store>_refit_<j>`` as well as ``<store>_quarter_*``;
  3. the artifact policy rows carry honest display texts (RAW-0.95, B2, P-CR) with unchanged keys / row names.
Tiny SQLite panels only.
"""
from datetime import date, timedelta
from unittest import mock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.inventory import Inventory
from app.models.inventory_daily import InventoryDaily
from app.models.policy_selection import PolicySelection
from app.models.product import Product
from app.models.replenishment import ReplenishmentRecommendation
from app.models.sales_history import SalesHistory
from app.models.sim_clock import SimClock
from app.models.sim_state import SimShadowDaily
from app.services import policy_artifact
from app.services import policy_config as pc
from app.services.simulator_service import simulator_service

START = date(2016, 4, 25)
ITEM = "FOODS_1_001"
PRICE = 10.0


def _db(on_hand: float, demand: list):
    """One SKU, clock at START (clean start); demand[i] is the sales of START + i (day 0 included)."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)()
    db.add(SimClock(store_id="CA_1", current_date=START, start_date=START))
    db.add(Product(item_id=ITEM, name="Item", cat_id="FOODS", dept_id="FOODS_1", price=PRICE))
    db.add(Inventory(item_id=ITEM, store_id="CA_1", on_hand=on_hand, on_order=0.0))
    for i, q in enumerate(demand):
        db.add(SalesHistory(id=f"s{i}", item_id=ITEM, store_id="CA_1", sale_date=START + timedelta(days=i),
                            quantity=q))
    db.commit()
    return db


def _rows(db, model):
    db.expire_all()
    return {r.date: r for r in db.query(model).filter(model.store_id == "CA_1").order_by(model.date).all()}


def test_start_date_demand_is_simulated_and_costed():
    """Clock at t0, advance 1 day -> days t0 AND t0+1 are simulated. Orders are switched off so the A3 cost is
    hand-computable: stock 5, demand 3 then 4 -> day 0: sold 3, end 2; day 1: sold 2, lost 2, end 0."""
    db = _db(on_hand=5.0, demand=[3.0, 4.0])
    with mock.patch("app.services.replenishment_service.replenishment_service.generate_recommendations",
                    return_value=0):
        res = simulator_service.advance(db, "CA_1", days=1)
    assert res["day0_review_executed"] is True
    assert res["days_advanced"] == 1 and res["days_simulated"] == 2
    assert res["reviews_executed"] == 1  # the review at the start of t0 only

    main = _rows(db, InventoryDaily)
    assert sorted(main) == [START, START + timedelta(days=1)]
    d0, d1 = main[START], main[START + timedelta(days=1)]
    assert (d0.sales, d0.lost_sales, d0.on_hand_end, bool(d0.stockout)) == (3.0, 0.0, 2.0, False)
    assert (d1.sales, d1.lost_sales, d1.on_hand_end, bool(d1.stockout)) == (2.0, 2.0, 0.0, True)
    assert res["stockouts_recorded"] == 1

    # A3 cost over the simulated days (t0 included): h*p*sum(on_hand_end) + b*p*sum(lost) + c*orders
    n_orders = db.query(ReplenishmentRecommendation).count()
    assert n_orders == 0
    cost = sum(pc.HOLDING_RATE_DAILY * PRICE * r.on_hand_end + pc.STOCKOUT_PENALTY_RATE * PRICE * r.lost_sales
               for r in main.values()) + pc.ORDER_COST_C * n_orders
    assert cost == pytest.approx(0.002 * 10 * (2 + 0) + 0.35 * 10 * 2)  # 0.04 + 7.0 = 7.04
    assert cost == pytest.approx(7.04)

    # the shadow B0 sees the same day-0 demand (no history before t0 -> S = 0 -> no B0 order)
    sh = _rows(db, SimShadowDaily)
    assert sorted(sh) == [START, START + timedelta(days=1)]
    assert (sh[START].sales, sh[START].on_hand_end) == (3.0, 2.0)
    assert (sh[START + timedelta(days=1)].lost_sales, sh[START + timedelta(days=1)].on_hand_end) == (2.0, 0.0)

    # inventory and clock: day 0 is not simulated again by the next advance
    db.expire_all()
    assert db.query(Inventory).one().on_hand == 0.0
    assert db.query(SimClock).one().current_date == START + timedelta(days=1)


def test_next_advance_does_not_resimulate_start_date():
    db = _db(on_hand=50.0, demand=[1.0, 2.0, 3.0, 4.0])
    with mock.patch("app.services.replenishment_service.replenishment_service.generate_recommendations",
                    return_value=0):
        simulator_service.advance(db, "CA_1", days=1)
        res = simulator_service.advance(db, "CA_1", days=2)
    assert res["day0_review_executed"] is False and res["days_simulated"] == 2
    main = _rows(db, InventoryDaily)
    assert [r.sales for r in main.values()] == [1.0, 2.0, 3.0, 4.0]
    assert main[START + timedelta(days=3)].on_hand_end == 40.0


def test_missing_start_date_demand_is_rejected():
    """The start date is simulated, so its demand must exist (never silently simulated as zero)."""
    from fastapi import HTTPException

    db = _db(on_hand=5.0, demand=[3.0, 4.0])
    db.query(SalesHistory).filter(SalesHistory.sale_date == START).delete()
    db.commit()
    with pytest.raises(HTTPException) as ei:
        simulator_service.advance(db, "CA_1", days=1)
    assert ei.value.status_code == 400 and str(START) in ei.value.detail


def test_reset_drops_store_refit_and_quarter_selections_only():
    db = _db(on_hand=5.0, demand=[3.0, 4.0])
    keep = ["CA_2_refit_1", "CA_2_quarter_2016_Q2", "seed", "quarter_2016_Q2", "CA_10_refit_1"]
    drop = ["CA_1_refit_0", "CA_1_refit_3", "CA_1_quarter_2016_Q2"]
    for sid in keep + drop:
        db.add(PolicySelection(selection_id=sid, class_id="AX", m_g=0.0, kappa_g=1.0))
    db.commit()
    with mock.patch("app.services.replenishment_service.replenishment_service.generate_recommendations",
                    return_value=0):
        simulator_service.advance(db, "CA_1", days=1)
    clock, info = simulator_service.reset(db, "CA_1")
    db.expire_all()
    left = sorted(r.selection_id for r in db.query(PolicySelection).all())
    assert left == sorted(keep)
    # the simulated start-date row is cleared too, and the stock is the snapshot taken before day 0
    assert db.query(InventoryDaily).count() == 0
    assert info["snapshot_restored"] is True
    assert db.query(Inventory).one().on_hand == 5.0
    assert clock.current_date == START


def test_artifact_policy_display_texts_are_honest_and_keys_unchanged():
    rows = policy_artifact.POLICY_ROWS
    assert list(rows) == ["B0", "B2", "PCR", "P6"]
    assert [rows[k][0] for k in rows] == [
        "B0 DFIOS τ=0.95", "B2 DFIOS τ*=0.99 [BIKIP]", "P-CR C³-OUT τ=0.9615 [BIKIP]", "P C³-OUT τ=0.95"]
    b0_label, b0_desc = rows["B0"][1:]
    assert b0_label.startswith("RAW-0.95") and "RAW-0.95" in b0_desc
    assert "B0 - Raw quantile" not in b0_label
    b2_label, b2_desc = rows["B2"][1:]
    assert "không phải critical ratio 0.9615" in b2_label and "0.99" in b2_desc
    assert "(critical ratio)" not in b2_label and "tối ưu chi phí" not in b2_desc
    pcr_desc = rows["PCR"][2]
    assert "b/(b+h·R) = 0.9615" in pcr_desc and "b/(b+h·H)" not in pcr_desc
    assert "không phải tối ưu chi phí đã được chứng minh riêng" in pcr_desc
    # the critical ratio really is b / (b + h * R) with the A3 rates
    cr = pc.STOCKOUT_PENALTY_RATE / (pc.STOCKOUT_PENALTY_RATE + pc.HOLDING_RATE_DAILY * pc.REVIEW_PERIOD_DAYS)
    assert round(cr, 4) == 0.9615


def test_day0_rows_are_counted_in_dashboard_and_report_kpis():
    """Clock still at START: only day-0 inventory / shadow / review rows exist and the KPIs must include them."""
    from app.repositories.reports_repository import reports_repository
    from app.services.dashboard_service import DashboardService, dashboard_service

    db = _db(on_hand=5.0, demand=[3.0])
    db.add(InventoryDaily(store_id="CA_1", item_id=ITEM, date=START, on_hand_end=2.0, sales=3.0, lost_sales=1.0))
    db.add(SimShadowDaily(store_id="CA_1", item_id=ITEM, date=START, on_hand_end=1.0, sales=3.0, lost_sales=2.0,
                          order_qty=4.0))
    db.add(ReplenishmentRecommendation(item_id=ITEM, store_id="CA_1", status="APPROVED", review_date=START,
                                       recommended_qty=1.0, final_qty=1.0))
    db.commit()

    daily = DashboardService._daily_costs(db, InventoryDaily, ["CA_1"], START, START)
    assert daily[START] == pytest.approx((2.0 * PRICE * pc.HOLDING_RATE_DAILY, 1.0 * PRICE * pc.STOCKOUT_PENALTY_RATE))

    cc = reports_repository.get_cost_comparison_report(db, "CA_1")
    assert cc["reason"] is None
    assert cc["ml_policy"]["order_cost"] == pc.ORDER_COST_C
    assert cc["baseline_policy"]["order_cost"] == pc.ORDER_COST_C
    assert cc["ml_policy"]["holding_cost"] > 0 and cc["ml_policy"]["stockout_penalty_cost"] > 0

    kpi = dashboard_service.get_shadow_baseline_dashboard(db, "CA_1")
    p0 = kpi.cost_curves[0]
    assert p0 is not None
    assert p0.c3out_ordering_cost == pc.ORDER_COST_C and p0.c3out_holding_cost > 0
    assert p0.b0_ordering_cost == pc.ORDER_COST_C
