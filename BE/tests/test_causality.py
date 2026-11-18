"""
Causality (demo.md §10 test table: "Đột biến doanh số sau as_of không làm đổi đơn tại as_of").

Two identical stores except that every sale AFTER the cut day is multiplied by 50 in store B. Both are simulated by
the REAL engine (J1 sales, J6, J3 window quantiles, J4 C3-OUT + parameters + orders, shadow B0; nothing mocked) up to
the cut day. Everything the engine decided up to the cut must be identical: proposals (quantity, status, IP), the
(s, S, EOQ) parameters, the controller state theta, the stored window quantiles and the daily stock. A difference
would mean the engine read demand of a day it had not reached yet (look-ahead leakage).

Then a planner-mode run is checked the same way, and an advance past the cut confirms the spike DOES change
later decisions (the test can detect a difference at all).
"""
from datetime import date, timedelta

import numpy as np
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.calibration_state import CalibrationState
from app.models.classification import SKUClassification
from app.models.forecast_window_quantile import ForecastWindowQuantile
from app.models.inventory import Inventory
from app.models.inventory_daily import InventoryDaily
from app.models.inventory_param import InventoryParam
from app.models.product import Product
from app.models.replenishment import ReplenishmentRecommendation
from app.models.sales_history import SalesHistory
from app.models.sim_clock import SimClock
from app.models.sim_state import SimShadowDaily
from app.services.simulator_service import simulator_service

STORE = "CA_1"
START = date(2016, 1, 4)
HISTORY_DAYS = 70          # sales before the clock start (initial stock, 56-day statistics)
SIM_DAYS = 70
CUT = START + timedelta(days=35)   # review k = 5 (R = 7): the "as_of" day
ITEMS = [f"FOODS_1_{i:03d}" for i in range(1, 9)]
# ABC-XYZ class per SKU so that J6 / C3-OUT really run per class (theta can move)
SEGMENTS = ["AX", "AY", "CZ", "CZ", "CZ", "AX", "BY", "BZ"]
SPIKE = 50.0


def _demand_panel(seed: int = 7) -> np.ndarray:
    """(items, days) smooth / intermittent / lumpy demand, deterministic."""
    rng = np.random.default_rng(seed)
    n_days = HISTORY_DAYS + SIM_DAYS + 1
    rates = [6.0, 3.0, 1.0, 0.4, 0.15, 8.0, 2.0, 0.6]
    out = np.zeros((len(ITEMS), n_days))
    for k, lam in enumerate(rates):
        out[k] = rng.poisson(lam, n_days) * (rng.random(n_days) < (0.35 if lam < 1 else 1.0))
    return out


def _store(spike_after: date | None):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)()
    db.add(SimClock(store_id=STORE, current_date=START, start_date=START))
    Y = _demand_panel()
    day0 = START - timedelta(days=HISTORY_DAYS)
    for k, item in enumerate(ITEMS):
        db.add(Product(item_id=item, name=item, cat_id="FOODS", dept_id="FOODS_1", price=2.0 + k))
        db.add(Inventory(item_id=item, store_id=STORE, on_hand=0.0, on_order=0.0))
        seg = SEGMENTS[k]
        db.add(SKUClassification(id=f"cls_{item}", item_id=item, store_id=STORE, abc_class=seg[0], xyz_class=seg[1],
                                 segment=seg))
        for j in range(Y.shape[1]):
            d = day0 + timedelta(days=j)
            q = float(Y[k, j])
            if spike_after is not None and d > spike_after:
                q = q * SPIKE + SPIKE
            db.add(SalesHistory(id=f"{item}_{j}", item_id=item, store_id=STORE, sale_date=d, quantity=q))
    db.commit()
    # initial stock as at a real clock start (round(mean 28 days * (L + R)))
    sim = simulator_service
    levels = sim.initial_inventory_levels(db, STORE, ITEMS)
    for item, lv in zip(ITEMS, levels):
        db.query(Inventory).filter_by(item_id=item, store_id=STORE).update({"on_hand": float(lv)})
    db.commit()
    return db


def _advance_to(db, target: date, **kw):
    while True:
        db.expire_all()
        cur = db.query(SimClock).one().current_date
        if cur >= target and not (cur == START and db.query(InventoryDaily).count() == 0):
            return
        simulator_service.advance(db, STORE, until=target, **kw)
        if kw.get("approval_mode") == "planner":
            # approve every open proposal at its proposed quantity (deterministic planner)
            from app.services.replenishment_service import replenishment_service

            for rec in db.query(ReplenishmentRecommendation).filter_by(status="PENDING").all():
                replenishment_service.approve_recommendation(db, rec.id, user_email="planner@dfios.com")


def _state(db, upto: date) -> dict:
    db.expire_all()
    recs = sorted(
        (r.item_id, r.review_date, round(r.recommended_qty, 6), round(r.final_qty, 6), r.status,
         round(r.inventory_position or 0.0, 6))
        for r in db.query(ReplenishmentRecommendation).filter(ReplenishmentRecommendation.review_date <= upto)
    )
    params = sorted((p.item_id, round(p.s or 0, 6), round(p.S or 0, 6), round(p.eoq or 0, 6))
                    for p in db.query(InventoryParam).filter_by(store_id=STORE))
    theta = sorted((c.class_id, c.review_index, round(float(c.theta), 9))
                   for c in db.query(CalibrationState).filter_by(store_id=STORE))
    quant = sorted((q.item_id, q.origin_date, round(q.point_window or 0, 6),
                    tuple(sorted((k, round(v, 6)) for k, v in (q.q_levels or {}).items())))
                   for q in db.query(ForecastWindowQuantile).filter(ForecastWindowQuantile.origin_date <= upto))
    daily = sorted((d.item_id, d.date, round(d.on_hand_end, 6), round(d.lost_sales, 6))
                   for d in db.query(InventoryDaily).filter(InventoryDaily.date <= upto))
    shadow = sorted((d.item_id, d.date, round(d.on_hand_end, 6), round(d.order_qty, 6))
                    for d in db.query(SimShadowDaily).filter(SimShadowDaily.date <= upto))
    return {"orders": recs, "params": params, "theta": theta, "quantiles": quant, "daily": daily, "b0": shadow}


@pytest.mark.parametrize("mode", ["auto", "planner"])
def test_future_demand_spike_does_not_change_decisions_up_to_as_of(mode):
    a, b = _store(None), _store(CUT)
    _advance_to(a, CUT, approval_mode=mode)
    _advance_to(b, CUT, approval_mode=mode)
    sa, sb = _state(a, CUT), _state(b, CUT)
    assert sa["orders"], "the panel must produce orders, otherwise the test proves nothing"
    assert sa["daily"] and sa["quantiles"]
    assert any(t[2] != 0.0 for t in sa["theta"]), "C3-OUT must have moved theta, otherwise theta is not tested"
    for key in sa:
        assert sa[key] == sb[key], f"look-ahead leakage: '{key}' at {CUT} depends on demand after {CUT}"


def test_spike_after_as_of_is_visible_once_the_clock_passes_it():
    """Control: the same comparison AFTER the cut differs, so the equality above is not vacuous."""
    a, b = _store(None), _store(CUT)
    later = CUT + timedelta(days=14)
    _advance_to(a, later)
    _advance_to(b, later)
    sa, sb = _state(a, later), _state(b, later)
    assert sa["daily"] != sb["daily"]
    assert sa["orders"] != sb["orders"]
