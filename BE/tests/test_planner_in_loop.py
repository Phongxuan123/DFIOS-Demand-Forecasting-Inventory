"""
Planner in the loop (demo.md §4.4 step 4 / §6 steps 6-7): with ``approval_mode="planner"`` the simulated review
leaves its proposals PENDING, the advance stops at that review day, the planner edits / approves them and the
approved quantity (``final_qty`` = q_final) is what arrives L days later. Tiny SQLite panels only; the proposal
generator is replaced by a deterministic stub (one proposal of 10 units per review) so the flow is hand-checkable.
"""
from datetime import date, timedelta
from unittest import mock

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.inventory import Inventory
from app.models.inventory_daily import InventoryDaily
from app.models.product import Product
from app.models.replenishment import ReplenishmentRecommendation
from app.models.sales_history import SalesHistory
from app.models.sim_clock import SimClock
from app.schemas.replenishment import ReplenishmentAdjustRequest
from app.services.replenishment_service import replenishment_service
from app.services.simulator_service import SIM_ACTOR, simulator_service

START = date(2016, 4, 25)
ITEM = "FOODS_1_001"
STORE = "CA_1"
Q = 10.0
GEN = "app.services.replenishment_service.replenishment_service.generate_recommendations"


def _db(n_days: int = 40, on_hand: float = 0.0):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)()
    db.add(SimClock(store_id=STORE, current_date=START, start_date=START))
    db.add(Product(item_id=ITEM, name="Item", cat_id="FOODS", dept_id="FOODS_1", price=10.0))
    db.add(Inventory(item_id=ITEM, store_id=STORE, on_hand=on_hand, on_order=0.0))
    for i in range(n_days):  # zero demand: the stock only moves by arrivals
        db.add(SalesHistory(id=f"s{i}", item_id=ITEM, store_id=STORE, sale_date=START + timedelta(days=i), quantity=0.0))
    db.commit()
    return db


def _fake_generate(db, store_id="CA_1", review_date=None, auto_order=False, origin=None):
    """One proposal of Q units per review, with the same status / on_order semantics as the real generator."""
    db.add(ReplenishmentRecommendation(
        item_id=ITEM, store_id=store_id, recommended_qty=Q, final_qty=Q, review_date=review_date, origin=origin,
        status="APPROVED" if auto_order else "PENDING", decided_by=SIM_ACTOR if auto_order else None,
    ))
    if auto_order:
        db.query(Inventory).filter(Inventory.item_id == ITEM).one().on_order += Q
    db.flush()
    return 1


def _advance(db, **kw):
    with mock.patch(GEN, side_effect=_fake_generate):
        return simulator_service.advance(db, STORE, approval_mode="planner", **kw)


def _recs(db):
    db.expire_all()
    return db.query(ReplenishmentRecommendation).order_by(ReplenishmentRecommendation.review_date).all()


def _on_hand_end(db, d):
    db.expire_all()
    return db.query(InventoryDaily).filter(InventoryDaily.date == d).one().on_hand_end


def test_first_planner_advance_stops_at_day0_review_with_pending_proposal():
    db = _db()
    res = _advance(db, days=20)
    assert res["stopped_at_review"] is True and res["approval_mode"] == "planner"
    assert res["current_date"] == START and res["day0_review_executed"] is True and res["days_simulated"] == 1
    (rec,) = _recs(db)
    assert (rec.status, rec.origin, rec.review_date, rec.decided_by) == ("PENDING", SIM_ACTOR, START, None)
    db.expire_all()
    assert db.query(Inventory).one().on_order == 0.0  # nothing is ordered before the planner approves
    assert db.query(InventoryDaily).count() == 1      # day 0 simulated, the clock stays at t0


def test_advance_is_refused_while_simulator_proposals_are_open():
    db = _db()
    _advance(db, days=20)
    with pytest.raises(HTTPException) as ei:
        _advance(db, days=20)
    assert ei.value.status_code == 409
    db.expire_all()
    assert db.query(SimClock).one().current_date == START  # untouched


def test_approved_final_qty_arrives_after_lead_time_and_next_stop_is_next_review():
    db = _db()
    _advance(db, days=20)
    (rec,) = _recs(db)
    replenishment_service.adjust_quantity(db, rec.id, ReplenishmentAdjustRequest(final_qty=4, reason="planner cut"),
                                          user_email="planner@dfios.com")
    replenishment_service.approve_recommendation(db, rec.id, user_email="planner@dfios.com")

    res = _advance(db, days=20)
    assert res["current_date"] == START + timedelta(days=7) and res["stopped_at_review"] is True
    # q_final = 4 (not the recommended 10) arrives at review_date + L = day 3
    assert _on_hand_end(db, START + timedelta(days=2)) == 0.0
    assert _on_hand_end(db, START + timedelta(days=3)) == 4.0
    recs = _recs(db)
    assert [(r.status, r.final_qty) for r in recs] == [("COMPLETED", 4.0), ("PENDING", Q)]
    assert recs[0].recommended_qty == Q  # the proposal keeps the recommended quantity next to the approved one


def test_expire_pending_skips_open_proposals_without_ordering():
    db = _db()
    _advance(db, days=20)
    res = _advance(db, days=20, expire_pending=True)
    assert res["pending_expired"] == 1 and res["current_date"] == START + timedelta(days=7)
    first = _recs(db)[0]
    assert first.status == "REJECTED" and first.decided_by == SIM_ACTOR
    assert _on_hand_end(db, START + timedelta(days=3)) == 0.0  # expired -> never ordered


def test_reset_removes_planner_approved_simulator_proposals():
    db = _db()
    _advance(db, days=20)
    (rec,) = _recs(db)
    replenishment_service.approve_recommendation(db, rec.id, user_email="planner@dfios.com")
    manual = ReplenishmentRecommendation(item_id=ITEM, store_id=STORE, recommended_qty=1, final_qty=1,
                                         status="PENDING", review_date=START)
    db.add(manual)
    db.commit()
    clock, _ = simulator_service.reset(db, STORE)
    assert clock.current_date == START
    assert [r.id for r in _recs(db)] == [manual.id]  # proposals created outside the simulation stay
    db.expire_all()
    assert db.query(InventoryDaily).count() == 0
    # back to a clean start: the next advance runs the day-0 review again
    assert _advance(db, days=3)["day0_review_executed"] is True


def test_seeded_pending_proposal_does_not_block_or_hide_the_sku():
    """A PENDING proposal created outside the simulation (bootstrap seed) neither blocks the planner advance nor
    stops the review from proposing the SKU."""
    db = _db()
    db.add(ReplenishmentRecommendation(item_id=ITEM, store_id=STORE, recommended_qty=1, final_qty=1,
                                       status="PENDING", review_date=START))
    db.commit()
    res = _advance(db, days=5)
    assert res["recommendations_generated"] == 1 and res["pending_expired"] == 0


def test_auto_mode_is_unchanged_default():
    db = _db()
    with mock.patch(GEN, side_effect=_fake_generate):
        res = simulator_service.advance(db, STORE, days=10)
    assert res["approval_mode"] == "auto" and res["stopped_at_review"] is False
    assert res["current_date"] == START + timedelta(days=10)
    assert all(r.status in ("APPROVED", "COMPLETED") for r in _recs(db))


def test_unknown_approval_mode_is_rejected():
    db = _db()
    with pytest.raises(HTTPException) as ei:
        simulator_service.advance(db, STORE, days=1, approval_mode="manual")
    assert ei.value.status_code == 422


@pytest.mark.parametrize("prev_offset,expected", [(0, 7), (3, 7), (6, 7), (7, 14), (13, 14)])
def test_first_review_day_after_day0(prev_offset, expected):
    prev = START + timedelta(days=prev_offset)
    assert simulator_service._first_review_day(prev, START, 7, clean_start=False) == START + timedelta(days=expected)
    assert simulator_service._first_review_day(START, START, 7, clean_start=True) == START
