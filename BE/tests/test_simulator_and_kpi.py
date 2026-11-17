"""
Tests of the simulator J1-J6 (atomicity, review at start of day, COMPLETED never received twice, snapshot reset,
shadow B0), of the what-if simulation endpoint (real Session incl. the price query) and of the self-describing
KPI / report layers. Everything runs through real SQLAlchemy sessions (SQLite in memory).
"""
import unittest
from datetime import date, timedelta
from unittest import mock

from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core.security import create_access_token, get_password_hash
from app.main import app
from tests.artifact_marks import requires_c3ok_results
from app.models.base import Base
from app.models.calibration_state import CalibrationState
from app.models.inventory import Inventory
from app.models.inventory_daily import InventoryDaily
from app.models.product import Product
from app.models.replenishment import ReplenishmentRecommendation
from app.models.sales_history import SalesHistory
from app.models.service_outcomes import ServiceOutcome
from app.models.sim_clock import SimClock
from app.models.sim_state import SimShadowDaily, SimSnapshot
from app.models.user import User
from app.services import policy_config as pc
from app.services.pipeline_service import pipeline_service

START = date(2016, 4, 25)
ITEM = "FOODS_1_001"


def _make_db(initial_on_hand=0.0, demand=2.0, n_days=21, price=10.0):
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)
    db = Session()
    db.add(SimClock(store_id="CA_1", current_date=START, start_date=START))
    db.add(Product(item_id=ITEM, name="Item", cat_id="FOODS", dept_id="FOODS_1", price=price))
    db.add(Inventory(item_id=ITEM, store_id="CA_1", on_hand=initial_on_hand, on_order=0.0))
    for i in range(0, n_days + 1):  # the start date is a simulated day too (P2)
        db.add(SalesHistory(id=f"s{i}", item_id=ITEM, store_id="CA_1", sale_date=START + timedelta(days=i), quantity=demand))
    db.commit()
    return engine, Session, db


def _inv(db):
    db.expire_all()
    r = db.query(Inventory).filter_by(item_id=ITEM, store_id="CA_1").one()
    return r.on_hand, r.on_order


class TestSimulator(unittest.TestCase):
    def test_review_at_start_of_day_gives_effective_lead_time_L(self):
        """P-21: order placed at the START of review day t is received at the start of t+L, not t+L-1."""
        engine, Session, db = _make_db(initial_on_hand=0.0)
        L, R = pc.LEAD_TIME_DAYS, pc.REVIEW_PERIOD_DAYS
        review_day = START + timedelta(days=R)
        pipeline_service.advance_sim_clock(db, "CA_1", days=R)
        # Q-03: a review also runs at the START of day 0 (orders of review_date = START may exist)
        order = db.query(ReplenishmentRecommendation).filter_by(item_id=ITEM, review_date=review_day).one()
        self.assertEqual(order.review_date, review_day)
        self.assertEqual(order.status, "APPROVED")
        qty = order.final_qty
        self.assertGreater(qty, 0)
        self.assertEqual(_inv(db)[1], qty)  # in transit

        # up to t+L-1 the order has NOT arrived (days t, t+1, t+2 sell from old stock = lead time L)
        pipeline_service.advance_sim_clock(db, "CA_1", days=L - 1)
        db.expire_all()
        self.assertEqual(
            db.query(ReplenishmentRecommendation).filter_by(item_id=ITEM, review_date=review_day).one().status, "APPROVED")
        self.assertEqual(_inv(db)[1], qty)
        # at the start of t+L it arrives exactly once
        pipeline_service.advance_sim_clock(db, "CA_1", days=1)
        db.expire_all()
        o = db.query(ReplenishmentRecommendation).filter_by(item_id=ITEM, review_date=review_day).one()
        self.assertEqual(o.status, "COMPLETED")
        on_hand, on_order = _inv(db)
        self.assertEqual(on_order, 0.0)
        daily = db.query(InventoryDaily).filter_by(item_id=ITEM, date=review_day + timedelta(days=L)).one()
        prev = db.query(InventoryDaily).filter_by(item_id=ITEM, date=review_day + timedelta(days=L - 1)).one()
        self.assertAlmostEqual(daily.on_hand_end, prev.on_hand_end + qty - 2.0)  # qty received, demand 2 served

    def test_completed_orders_never_received_again_and_approved_received_once(self):
        """P-16: COMPLETED rows are ignored; an APPROVED row is received exactly once."""
        engine, Session, db = _make_db(initial_on_hand=100.0, demand=1.0)
        db.add(ReplenishmentRecommendation(
            id="done", item_id=ITEM, store_id="CA_1", recommended_qty=1000, final_qty=1000, status="COMPLETED",
            review_date=START - timedelta(days=30)))
        db.add(ReplenishmentRecommendation(
            id="due", item_id=ITEM, store_id="CA_1", recommended_qty=50, final_qty=50, status="APPROVED",
            review_date=START - timedelta(days=30)))
        db.commit()
        inv = db.query(Inventory).filter_by(item_id=ITEM).one()
        inv.on_order = 50.0
        db.commit()
        pipeline_service.advance_sim_clock(db, "CA_1", days=1)
        db.expire_all()
        self.assertEqual(db.query(ReplenishmentRecommendation).filter_by(id="due").one().status, "COMPLETED")
        # 100 + 50 (once) - 1 sold on day 0 - 1 sold on day 1; the COMPLETED 1000 never arrives
        self.assertAlmostEqual(_inv(db)[0], 148.0)
        pipeline_service.advance_sim_clock(db, "CA_1", days=1)
        self.assertAlmostEqual(_inv(db)[0], 147.0)

    def test_day_step_is_atomic_failure_leaves_everything_untouched(self):
        """P-16 / N-08: error mid-advance -> rollback incl. clock, inventory and inventory_daily."""
        engine, Session, db = _make_db(initial_on_hand=20.0)
        before = _inv(db)
        with mock.patch(
            "app.services.calibrator_service.calibrator_service.run_calibration_step",
            side_effect=RuntimeError("boom"),
        ):
            with self.assertRaises(RuntimeError):
                pipeline_service.advance_sim_clock(db, "CA_1", days=pc.REVIEW_PERIOD_DAYS)
        db.expire_all()
        self.assertEqual(db.query(SimClock).one().current_date, START)
        self.assertEqual(_inv(db), before)
        self.assertEqual(db.query(InventoryDaily).count(), 0)
        self.assertEqual(db.query(SimShadowDaily).count(), 0)
        self.assertEqual(db.query(ReplenishmentRecommendation).count(), 0)
        # the session is usable afterwards and the same advance now succeeds
        r = pipeline_service.advance_sim_clock(db, "CA_1", days=pc.REVIEW_PERIOD_DAYS)
        self.assertTrue(r["success"])

    def test_reset_restores_snapshot_and_is_idempotent_and_replay_is_deterministic(self):
        engine, Session, db = _make_db(initial_on_hand=15.0)
        from app.models.inventory_param import InventoryParam
        params0 = sorted((p.item_id, p.s, p.S) for p in db.query(InventoryParam).all())
        r1 = pipeline_service.advance_sim_clock(db, "CA_1", days=10)
        state1 = _inv(db)
        self.assertNotEqual(state1[0], 15.0)
        self.assertEqual(db.query(SimSnapshot).count(), 1)
        for _ in range(2):  # idempotent
            clock, info = pipeline_service.reset_sim_clock_with_info(db, "CA_1")
            self.assertEqual(clock.current_date, START)
            self.assertTrue(info["snapshot_restored"])
            self.assertEqual(_inv(db), (15.0, 0.0))
            self.assertEqual(db.query(InventoryDaily).filter(InventoryDaily.date > START).count(), 0)
            self.assertEqual(db.query(SimShadowDaily).count(), 0)
            self.assertEqual(db.query(ServiceOutcome).count(), 0)
            self.assertEqual(db.query(CalibrationState).filter(CalibrationState.review_index >= 1).count(), 0)
            self.assertEqual(db.query(ReplenishmentRecommendation).count(), 0)
            # (s, S) are back to the day-0 values (stale parameters raised alerts after a reset)
            self.assertGreater(info["parameters_recomputed"], 0)
            if params0:
                db.expire_all()
                self.assertEqual(sorted((p.item_id, p.s, p.S) for p in db.query(InventoryParam).all()), params0)
        r2 = pipeline_service.advance_sim_clock(db, "CA_1", days=10)
        self.assertEqual(_inv(db), state1)
        self.assertEqual(r1["stockouts_recorded"], r2["stockouts_recorded"])
        # reset to a date other than start_date is refused (state can only be restored to the snapshot)
        with self.assertRaises(HTTPException):
            pipeline_service.reset_sim_clock(db, "CA_1", target_date=START + timedelta(days=3))

    def test_stale_pending_loader_orders_do_not_block_reordering(self):
        """P-12: loader PENDING rows (review_date NULL / real date) never arrive and must not block the simulator."""
        engine, Session, db = _make_db(initial_on_hand=0.0)
        db.add(ReplenishmentRecommendation(
            id="loader", item_id=ITEM, store_id="CA_1", recommended_qty=500, final_qty=500, status="PENDING",
            review_date=None))
        db.commit()
        pipeline_service.advance_sim_clock(db, "CA_1", days=pc.REVIEW_PERIOD_DAYS)
        db.expire_all()
        sim_orders = db.query(ReplenishmentRecommendation).filter_by(item_id=ITEM, decided_by="simulator").all()
        # day-0 review (Q-03) + review at day R: both are simulator orders, none of them is the stale loader row
        self.assertEqual(sorted(o.review_date for o in sim_orders), [START, START + timedelta(days=pc.REVIEW_PERIOD_DAYS)])
        self.assertIn(sim_orders[0].status, ("APPROVED", "COMPLETED"))
        self.assertEqual(db.query(ReplenishmentRecommendation).filter_by(id="loader").one().status, "PENDING")

    def test_missing_demand_days_rejected_not_simulated_as_zero(self):
        engine, Session, db = _make_db(n_days=5)
        with self.assertRaises(HTTPException) as cm:
            pipeline_service.advance_sim_clock(db, "CA_1", days=7)
        self.assertEqual(cm.exception.status_code, 400)
        self.assertIn("dữ liệu cầu", cm.exception.detail)
        self.assertEqual(db.query(SimClock).one().current_date, START)

    def test_b0_shadow_is_simulated_in_parallel_not_derived(self):
        """N-03: B0 rows exist per day, are computed from their own stock/orders (not C3 x ratios)."""
        engine, Session, db = _make_db(initial_on_hand=14.0)
        r = pipeline_service.advance_sim_clock(db, "CA_1", days=14)
        self.assertEqual(db.query(SimShadowDaily).count(), 15)  # day 0 (simulated, with the day-0 B0 order) + 14 days
        self.assertIn("b0_shadow_stockouts_recorded", r)
        shadow = db.query(SimShadowDaily).order_by(SimShadowDaily.date).all()
        main = db.query(InventoryDaily).order_by(InventoryDaily.date).all()
        # same initial stock and demand -> identical until the first review decides differently
        self.assertEqual([s.on_hand_end for s in shadow[:6]], [m.on_hand_end for m in main[:6]])


class TestSimulationEndpointAndKpi(unittest.TestCase):
    def setUp(self):
        self.engine, self.Session, self.db = _make_db(initial_on_hand=30.0, price=4.0)
        self.db.add(User(id="m1", email="m1@dfios.com", password_hash=get_password_hash("Manager123"),
                         role="Warehouse Manager", display_name="M", is_active=True, is_verified=True, token_version=1))
        self.db.commit()

        def override():
            s = self.Session()
            try:
                yield s
            finally:
                s.close()

        app.dependency_overrides[get_db] = override
        self.client = TestClient(app)
        self.h = {"Authorization": "Bearer " + create_access_token({"sub": "m1@dfios.com", "token_version": 1})}

    def tearDown(self):
        app.dependency_overrides.clear()

    @requires_c3ok_results
    def test_compare_policies_through_real_session_with_price_query(self):
        """P-06: the Postgres-style path (db is not None) used to crash on Product.sell_price."""
        r = self.client.post("/api/v1/simulation/compare-policies",
                             json={"store_id": "CA_1", "horizon_days": 90, "target_service_level": 0.96}, headers=self.h)
        self.assertEqual(r.status_code, 200, r.text)
        d = r.json()
        self.assertEqual(d["source"], "artifact_extract")
        self.assertFalse(d["simulated"])
        self.assertEqual(d["n_skus"], 1)
        self.assertEqual(d["artifact_n_skus"], 25950)
        self.assertEqual(d["artifact_n_days"], 357)
        self.assertEqual(d["price_source"], "products.price")
        self.assertAlmostEqual(d["avg_price"], 4.0)
        ids = {p["policy_id"]: p for p in d["policies"]}
        self.assertEqual(set(ids), {"B0_raw_quantile", "B2_frozen_critical_ratio", "PCR_c3out_cost_optimal", "P6_c3out_closed_loop"})
        # labels follow the artifact rows
        self.assertEqual(ids["B0_raw_quantile"]["tau"], 0.95)
        self.assertEqual(ids["B2_frozen_critical_ratio"]["tau"], 0.99)
        self.assertEqual(ids["PCR_c3out_cost_optimal"]["tau"], 0.9615)
        self.assertEqual(ids["P6_c3out_closed_loop"]["tau"], 0.95)
        self.assertTrue(ids["PCR_c3out_cost_optimal"]["artifact_row"].startswith("P-CR"))
        # P-CR is cheaper than P6 in the artifact and it is the recommendation at target 0.96
        self.assertLess(ids["PCR_c3out_cost_optimal"]["artifact_total_cost"], ids["P6_c3out_closed_loop"]["artifact_total_cost"])
        self.assertEqual(d["recommended_policy"], "PCR_c3out_cost_optimal")
        self.assertFalse(ids["B0_raw_quantile"]["is_feasible"])
        # scale = (1/25950) * (90/357)
        row = ids["P6_c3out_closed_loop"]
        self.assertAlmostEqual(d["scale_factor"], (1 / 25950) * (90 / 357), places=10)
        self.assertAlmostEqual(row["total_cost"], row["artifact_total_cost"] * d["scale_factor"], delta=0.05)
        # P6 at 0.99 target is not feasible (no hard-coded feasibility)
        r99 = self.client.post("/api/v1/simulation/compare-policies",
                               json={"store_id": "CA_1", "horizon_days": 90, "target_service_level": 0.99}, headers=self.h).json()
        self.assertFalse({p["policy_id"]: p for p in r99["policies"]}["P6_c3out_closed_loop"]["is_feasible"])
        self.assertTrue(any("không phải mô phỏng" in s or "KHÔNG phải" in s for s in d["insights"]))

    def test_missing_artifact_is_explicit_error_not_embedded_constants(self):
        with mock.patch("app.services.policy_artifact.find_artifact", return_value=None):
            r = self.client.post("/api/v1/simulation/compare-policies", json={"store_id": "CA_1"}, headers=self.h)
        self.assertEqual(r.status_code, 503)
        self.assertIn("c3ok_results.csv", r.json()["detail"])

    @requires_c3ok_results
    def test_policy_comparison_report_labels_and_provenance(self):
        r = self.client.get("/api/v1/reports/policy-comparison", headers=self.h)
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertEqual(d["source"], "artifact_extract")
        self.assertEqual(d["n_skus"], 25950)
        self.assertEqual(d["n_days"], 357)
        self.assertEqual(set(d["policies"]), {"B0", "B2", "PCR", "P6"})
        self.assertLess(d["policies"]["PCR"]["total_cost_paper"], d["policies"]["P6"]["total_cost_paper"])
        self.assertAlmostEqual(d["policies"]["P6"]["csl"], 0.949, places=3)

    def test_kpi_dashboard_null_with_reason_before_any_simulation(self):
        r = self.client.get("/api/v1/dashboard/kpi-dashboard?store_id=CA_1", headers=self.h)
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertIsNone(d["c3out_overall_availability"])
        self.assertIsNone(d["b0_overall_availability"])
        self.assertIsNone(d["c3out_total_cost"])
        self.assertTrue(d["availability_reason"])
        self.assertTrue(d["cost_reason"])
        self.assertEqual(d["source"], "simulator")
        self.assertEqual(d["target_availability"], 95.0)  # from settings default, not a literal 96

    def test_kpi_dashboard_after_simulation_uses_real_shadow_b0(self):
        db = self.Session()
        pipeline_service.advance_sim_clock(db, "CA_1", days=14)
        d = self.client.get("/api/v1/dashboard/kpi-dashboard?store_id=CA_1", headers=self.h).json()
        self.assertIsNotNone(d["b0_total_cost"])
        self.assertIsNotNone(d["c3out_total_cost"])
        self.assertAlmostEqual(d["total_cost_savings"], d["b0_total_cost"] - d["c3out_total_cost"], places=1)
        last = d["cost_curves"][-1]
        # A3 recomputation from the raw rows
        rows = db.query(InventoryDaily).filter(InventoryDaily.date > START, InventoryDaily.date <= START + timedelta(days=14)).all()
        h = sum(r.on_hand_end * 4.0 * pc.HOLDING_RATE_DAILY for r in rows)
        b = sum(r.lost_sales * 4.0 * pc.STOCKOUT_PENALTY_RATE for r in rows)
        self.assertAlmostEqual(last["c3out_holding_cost"], h, delta=0.05)
        self.assertAlmostEqual(last["c3out_stockout_cost"], b, delta=0.05)
        # ordering cost counts placed orders only
        placed = db.query(func.count(ReplenishmentRecommendation.id)).filter(
            ReplenishmentRecommendation.status.in_(("APPROVED", "COMPLETED"))).scalar()
        self.assertAlmostEqual(last["c3out_ordering_cost"], placed * pc.ORDER_COST_C)
        for seg in d["segment_availabilities"]:
            if seg["c3out_availability"] is not None:
                self.assertLessEqual(seg["c3out_availability"], 100.0)
        db.close()

    def test_clock_endpoints_are_self_describing(self):
        db = self.Session()
        db.add(User(id="a1", email="a1@dfios.com", password_hash=get_password_hash("Admin123"), role="Admin",
                    display_name="A", is_active=True, is_verified=True, token_version=1))
        db.commit()
        db.close()
        ha = {"Authorization": "Bearer " + create_access_token({"sub": "a1@dfios.com", "token_version": 1})}
        c = self.client.get("/api/v1/clock?store_id=CA_1", headers=self.h).json()
        self.assertEqual(c["lead_time_days"], 3)
        self.assertEqual(c["review_period_days"], 7)
        self.assertEqual(c["n_skus"], 1)
        self.assertEqual(c["as_of"], str(START))
        adv = self.client.post("/api/v1/clock/advance", json={"store_id": "CA_1", "days": 7}, headers=ha)
        self.assertEqual(adv.status_code, 200, adv.text)
        self.assertEqual(adv.json()["source"], "simulator")
        self.assertIn("duration_seconds", adv.json())
        rs = self.client.post("/api/v1/clock/reset", json={"store_id": "CA_1"}, headers=ha).json()
        self.assertTrue(rs["snapshot_restored"])
        self.assertEqual(rs["current_date"], str(START))


class TestPipelineNewStore(unittest.TestCase):
    def test_trigger_pipeline_run_new_store_inserts_forecasts_with_id(self):
        """P-08: Forecast(...) without the primary key `id` crashed for a store that had no forecasts yet."""
        from app.models.forecast import Forecast
        from app.schemas.pipeline import PipelineRunRequest

        engine, Session, db = _make_db()
        for i in range(1, 40):
            db.add(SalesHistory(id=f"tx{i}", item_id=ITEM, store_id="TX_9", sale_date=START + timedelta(days=i - 40), quantity=float(i % 5)))
        db.add(SimClock(store_id="TX_9", current_date=START, start_date=START))
        db.commit()
        res = pipeline_service.trigger_pipeline_run(db, PipelineRunRequest(store_id="TX_9", horizon=7, model_name="lightgbm"))
        self.assertEqual(res.status, "COMPLETED")
        rows = db.query(Forecast).filter(Forecast.store_id == "TX_9").all()
        self.assertGreater(len(rows), 0)
        self.assertEqual(res.forecasts_generated, len(rows))
        # Q-01: the fallback has its OWN model label and id namespace, never the production series id
        self.assertTrue(all(r.model_version == "pipeline-sba-croston-fallback" for r in rows))
        self.assertTrue(all(r.id.startswith("pipe_TX_9_") for r in rows))
        self.assertEqual(res.forecast_source, "sba-croston-fallback")
        # idempotent: a second run replaces, never collides
        res2 = pipeline_service.trigger_pipeline_run(db, PipelineRunRequest(store_id="TX_9", horizon=7, model_name="lightgbm"))
        self.assertEqual(res2.status, "COMPLETED")
        self.assertEqual(db.query(Forecast).filter(Forecast.store_id == "TX_9").count(), len(rows))

    def test_trigger_pipeline_run_without_sales_reports_zero_forecasts(self):
        from app.schemas.pipeline import PipelineRunRequest
        engine, Session, db = _make_db()
        res = pipeline_service.trigger_pipeline_run(db, PipelineRunRequest(store_id="WI_9", horizon=7, model_name="lightgbm"))
        self.assertEqual(res.forecasts_generated, 0)  # never sku_count * horizon


if __name__ == "__main__":
    unittest.main()
