"""
Regression tests of REVIEW ROUND 4 (backend): Q-01 pipeline idempotence / SBA labelling, Q-03/Q-04 simulator start
(day-0 review, start at S, reset restores theta), Q-05/Q-06/Q-08 J5, Q-09 scheduler, Q-10 login limiter,
Q-12/Q-13/Q-14, U-03 explanation, U-04 clock coupling.
"""
import time
import unittest
from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core.security import get_password_hash
from app.main import app
from app.models.base import Base
from app.models.calibration_state import CalibrationState
from app.models.classification import SKUClassification
from app.models.forecast import Forecast, ForecastExplanation
from app.models.inventory import Inventory
from app.models.inventory_param import InventoryParam
from app.models.policy_selection import PolicySelection
from app.models.product import Product
from app.models.sales_history import SalesHistory
from app.models.sim_clock import SimClock
from app.models.sim_state import SimShadowDaily
from app.models.user import User
from app.schemas.pipeline import PipelineRunRequest
from app.services import policy_config as pc
from app.services import scheduler_service
from app.services.calibrator_service import calibrator_service
from app.services.classification_service import classification_service
from app.services.optimization_service import optimization_service
from app.services.pipeline_service import pipeline_service
from app.services.simulator_service import simulator_service

START = date(2016, 4, 25)
ITEM = "FOODS_1_001"


def _db(n_days=21, demand=2.0, on_hand=0.0, price=10.0, with_params=True):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)
    db = Session()
    db.add(SimClock(store_id="CA_1", current_date=START, start_date=START))
    db.add(Product(item_id=ITEM, name="Item", cat_id="FOODS", dept_id="FOODS_1", price=price))
    db.add(Inventory(item_id=ITEM, store_id="CA_1", on_hand=on_hand, on_order=0.0))
    for i in range(0, n_days + 1):  # the start date is a simulated day too (P2)
        db.add(SalesHistory(id=f"s{i}", item_id=ITEM, store_id="CA_1", sale_date=START + timedelta(days=i),
                            quantity=demand))
    if with_params:
        db.add(InventoryParam(id=f"CA_1_{ITEM}", item_id=ITEM, store_id="CA_1", safety_stock=5.0,
                              reorder_point=20.0, eoq=10.0, s=20.0, S=37.0))
    db.commit()
    return Session, db


class TestPipelineIdempotent(unittest.TestCase):
    def test_sba_fallback_never_collides_with_ensemble_rows_and_is_labelled(self):
        """Q-01: an Ensemble row with the production id must not be hit by the SBA fallback (UniqueViolation)."""
        Session, db = _db()
        # Ensemble run already in `forecast` for ANOTHER store model name request -> the pipeline asks for lightgbm
        db.add(Forecast(id=f"{ITEM}_CA_1_evaluation", item_id=ITEM, store_id="CA_1", forecast_date=START + timedelta(days=30),
                        h=1, y_pred=3.0, available=True, model_version="Ensemble-v1"))
        db.commit()
        res = pipeline_service.trigger_pipeline_run(db, PipelineRunRequest(store_id="CA_1", horizon=7, model_name="lightgbm"))
        self.assertEqual(res.status, "COMPLETED")
        # the Ensemble run exists, so it is used as is: nothing generated, nothing mislabelled
        self.assertEqual(res.forecast_source, "existing")
        self.assertEqual(db.query(Forecast).filter(Forecast.model_version == "pipeline-sba-croston-fallback").count(), 0)

    def test_sba_fallback_is_idempotent_and_does_not_touch_other_models(self):
        Session, db = _db()
        db.add(Forecast(id="other", item_id=ITEM, store_id="TX_1", forecast_date=START, h=1, y_pred=1.0,
                        available=True, model_version="Ensemble-v1"))
        db.commit()
        for _ in range(3):
            r = pipeline_service.trigger_pipeline_run(db, PipelineRunRequest(store_id="CA_1", horizon=7, model_name="lightgbm"))
            self.assertEqual(r.forecast_source, "sba-croston-fallback")
            self.assertEqual(r.forecasts_generated, 7)
        rows = db.query(Forecast).filter(Forecast.store_id == "CA_1").all()
        self.assertEqual(len(rows), 7)
        self.assertTrue(all(x.model_version == "pipeline-sba-croston-fallback" for x in rows))
        self.assertEqual(db.query(Forecast).filter(Forecast.store_id == "TX_1").count(), 1)


class TestSimulatorStart(unittest.TestCase):
    def _seed_warm_start(self, db, theta=0.2):
        for c in pc.ALL_CLASSES:
            db.add(CalibrationState(id=f"CA_1_{c}_rev_0", calibrator_id="c3ok_artifact_final", store_id="CA_1",
                                    class_id=c, review_index=0, review_date=START, theta=theta, multiplier=1.2,
                                    setpoint=0.96, eta=1.0, at_boundary=False))
        db.commit()

    def test_initialise_baseline_starts_at_S_and_day0_review_runs(self):
        Session, db = _db(on_hand=3.0)  # 10x-mean-like artefact stock, below s
        info = simulator_service.initialise_baseline(db, "CA_1")
        self.assertEqual(info["total_on_hand"], 37.0)  # S of the SKU, not the loader stock
        r = pipeline_service.advance_sim_clock(db, "CA_1", days=7)
        self.assertEqual(r["reviews_executed"], 2)  # day 0 (start of day 0) and day 7
        # starting at S >= s: no stockout in week 1 (demand 2/day)
        self.assertEqual(r["stockouts_recorded"], 0)
        self.assertEqual(db.query(SimShadowDaily).filter(SimShadowDaily.date == START).count(), 1)  # day-0 B0 row

    def test_second_advance_does_not_repeat_day0_review(self):
        Session, db = _db()
        simulator_service.initialise_baseline(db, "CA_1")
        r1 = pipeline_service.advance_sim_clock(db, "CA_1", days=3)
        r2 = pipeline_service.advance_sim_clock(db, "CA_1", days=4)
        self.assertEqual(r1["reviews_executed"], 1)  # day 0 only
        self.assertEqual(r2["reviews_executed"], 1)  # day 7 only

    def test_reset_restores_warm_start_theta_and_removes_simulated_policy(self):
        Session, db = _db()
        self._seed_warm_start(db, theta=0.2)
        simulator_service.initialise_baseline(db, "CA_1")
        db.add(PolicySelection(selection_id="CA_1_quarter_2016_Q2", class_id="AX", m_g=0.0, kappa_g=2.0))
        db.commit()
        pipeline_service.advance_sim_clock(db, "CA_1", days=14)
        self.assertTrue(db.query(CalibrationState).filter(CalibrationState.review_index >= 1).count() > 0)
        pipeline_service.reset_sim_clock(db, "CA_1")
        thetas = calibrator_service.get_current_thetas(db, "CA_1")
        for c in pc.ALL_CLASSES:
            self.assertAlmostEqual(thetas[c], 0.2)  # Q-04: baseline INCLUDING the warm start
        self.assertEqual(db.query(CalibrationState).filter(CalibrationState.review_index >= 1).count(), 0)
        self.assertEqual(db.query(PolicySelection).filter(PolicySelection.selection_id == "CA_1_quarter_2016_Q2").count(), 0)
        # advancing again starts from the warm theta (no controller step at review 0)
        pipeline_service.advance_sim_clock(db, "CA_1", days=7)
        self.assertAlmostEqual(calibrator_service.get_current_thetas(db, "CA_1")["AX"], 0.2, places=3)


class TestJ5(unittest.TestCase):
    def test_selection_id_is_store_scoped_and_setpoint_is_target_plus_guard(self):
        self.assertEqual(optimization_service.tag_selection_id("quarter_2016_Q2", "CA_1"), "CA_1_quarter_2016_Q2")
        self.assertEqual(optimization_service.tag_selection_id("CA_2_quarter_2016_Q2", "CA_1"), "CA_2_quarter_2016_Q2")
        Session, db = _db()
        res = optimization_service.refit_quarterly_policies(db, store_id="CA_1", target_availability=0.9)
        self.assertTrue(all(r["selection_id"].startswith("CA_1_quarter_") for r in res))
        self.assertTrue(all(abs(r["setpoint"] - 0.91) < 1e-9 for r in res))
        # a store-scoped selection of CA_1 is invisible to another store's resolution
        self.assertEqual(calibrator_service.resolve_policies(db, "CA_2"), {})
        self.assertTrue(set(calibrator_service.resolve_policies(db, "CA_1")) == set(pc.ALL_CLASSES))
        # both candidates are reported (Q-08), also when no validation data exists (None, never invented)
        ax = next(r for r in res if r["class_id"] == "AX")
        for k in ("kappa_only_m_g", "kappa_only_val_service", "m_grid_m_g", "m_grid_val_cost", "search_mode", "source"):
            self.assertIn(k, ax)

    def test_invalid_search_mode_rejected(self):
        from fastapi import HTTPException
        Session, db = _db()
        with self.assertRaises(HTTPException):
            optimization_service.refit_quarterly_policies(db, store_id="CA_1", search_mode="bogus")


class TestScheduler(unittest.TestCase):
    def test_next_run_is_fast_and_correct(self):
        t0 = time.time()
        n = scheduler_service.next_run("30 2 * * *", datetime(2016, 5, 1, 3, 0, tzinfo=timezone.utc))
        self.assertEqual(n, datetime(2016, 5, 2, 2, 30, tzinfo=timezone.utc))
        # next Feb 29 is more than 366 days away -> None (bounded search)
        self.assertIsNone(scheduler_service.next_run("0 0 29 2 *", datetime(2016, 5, 1, 0, 0, tzinfo=timezone.utc)))
        self.assertIsNone(scheduler_service.next_run("bad cron"))
        self.assertLess(time.time() - t0, 1.0)

    def test_tick_skips_when_advisory_lock_is_held(self):
        """Postgres only: a second worker that cannot take pg_try_advisory_lock runs nothing."""
        from sqlalchemy import text
        from app.core.database import engine
        from sqlalchemy.exc import OperationalError
        if engine.dialect.name != "postgresql":
            self.skipTest("advisory lock needs PostgreSQL")
        try:  # CI has no PostgreSQL server: the configured default URL is not reachable there
            engine.connect().close()
        except OperationalError:
            self.skipTest("no reachable PostgreSQL server")
        with engine.connect() as holder:
            holder.execute(text("SELECT pg_advisory_lock(:k)"), {"k": scheduler_service.SCHEDULER_LOCK_KEY})
            try:
                self.assertEqual(scheduler_service._tick(), 0)
            finally:
                holder.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": scheduler_service.SCHEDULER_LOCK_KEY})
                holder.commit()


class TestLoginLimiter(unittest.TestCase):
    def test_spoofed_xff_cannot_bypass_per_email_limit(self):
        engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=engine)
        Session = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)
        with Session() as s:
            s.add(User(id="u1", email="victim@dfios.com", password_hash=get_password_hash("Right123"), role="Viewer",
                       display_name="V", is_active=True, is_verified=True, token_version=1))
            s.commit()

        def override():
            s = Session()
            try:
                yield s
            finally:
                s.close()

        app.dependency_overrides[get_db] = override
        try:
            client = TestClient(app)
            codes = []
            for i in range(14):
                r = client.post("/api/v1/auth/login", json={"email": "victim@dfios.com", "password": f"bad{i}"},
                                headers={"X-Forwarded-For": f"203.0.113.{i + 1}"})
                codes.append(r.status_code)
            self.assertIn(429, codes)
            self.assertEqual(codes[:10], [401] * 10)
        finally:
            app.dependency_overrides.clear()
            from app.services.email_token_service import rate_limiter
            rate_limiter.clear("login_email:victim@dfios.com")


class TestClockCoupling(unittest.TestCase):
    def test_history_and_compare_are_bounded_by_the_clock(self):
        from app.services.forecast_service import forecast_service
        Session, db = _db(n_days=10)
        r = forecast_service.get_historical_demand(db, ITEM, store_id="CA_1")
        self.assertTrue(r.bounded_by_clock)
        self.assertEqual(r.as_of, str(START))
        self.assertEqual(r.count, 1)  # only the sale dated ON the clock (START); the others are after it
        pipeline_service.advance_sim_clock(db, "CA_1", days=3)
        r2 = forecast_service.get_historical_demand(db, ITEM, store_id="CA_1")
        self.assertEqual([p.date for p in r2.history][-1], str(START + timedelta(days=3)))
        self.assertEqual(r2.count, 4)

    def test_demand_trend_hides_forecast_from_after_the_clock(self):
        from app.services.dashboard_service import dashboard_service
        Session, db = _db(n_days=10)
        for h in range(1, 4):
            db.add(Forecast(id=f"f{h}", item_id=ITEM, store_id="CA_1", forecast_date=START + timedelta(days=20 + h), h=h,
                            y_pred=5.0, available=True, model_version="Ensemble-v1"))
        db.commit()
        out = dashboard_service.get_demand_trend(db, store_id="CA_1", days=30)
        self.assertTrue(all(p.predicted is None for p in out.data))
        self.assertEqual(out.as_of, str(START))
        self.assertIn("hidden", out.forecast_note)
        pipeline_service.advance_sim_clock(db, "CA_1", days=10)
        # clock at +10, forecast origin is START+20 > clock -> still hidden; every actual is <= clock
        out2 = dashboard_service.get_demand_trend(db, store_id="CA_1", days=30)
        self.assertTrue(all(p.actual is None or p.date <= str(START + timedelta(days=10)) for p in out2.data))


class TestExplanation(unittest.TestCase):
    def test_no_fabricated_shap_and_stored_rows_are_returned(self):
        from app.services.forecast_service import forecast_service
        Session, db = _db()
        r = forecast_service.get_forecast_explanation(db, ITEM, store_id="CA_1")
        self.assertFalse(r.available)
        self.assertEqual(r.features, [])
        self.assertIsNone(r.base_value)
        db.add(ForecastExplanation(id="e1", item_id=ITEM, store_id="CA_1", model_version="v9", model_name="gbdt",
                                   feature_name="lag_7", importance_score=0.5, direction="positive"))
        db.commit()
        r2 = forecast_service.get_forecast_explanation(db, ITEM, store_id="CA_1")
        self.assertTrue(r2.available)
        self.assertEqual([f.feature_name for f in r2.features], ["lag_7"])


class TestPartialAssortmentAndGlobal(unittest.TestCase):
    def test_classification_and_replenishment_only_for_stocked_skus(self):
        Session, db = _db()
        db.add(Product(item_id="OTHER_1", name="o", cat_id="FOODS", dept_id="FOODS_1", price=3.0))
        db.add(Inventory(item_id=ITEM, store_id="ZZ_1", on_hand=0.0, on_order=0.0))
        db.add(SalesHistory(id="z1", item_id=ITEM, store_id="ZZ_1", sale_date=START, quantity=4.0))
        db.commit()
        n = classification_service.recompute_classification(db, store_id="ZZ_1")
        self.assertEqual(n, 1)  # not 2: OTHER_1 is not sold in ZZ_1
        self.assertEqual(db.query(SKUClassification).filter(SKUClassification.store_id == "ZZ_1").count(), 1)

    def test_global_matrix_aggregates_real_stores(self):
        Session, db = _db()
        classification_service.recompute_classification(db, store_id="CA_1")
        m = classification_service.get_matrix(db, store_id="GLOBAL")
        self.assertEqual(m.total_skus, 1)
        self.assertEqual(sum(s.sku_count for s in m.segments), 1)
        self.assertEqual(db.query(SKUClassification).filter(SKUClassification.store_id == "GLOBAL").count(), 0)


if __name__ == "__main__":
    unittest.main()
