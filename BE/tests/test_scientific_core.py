"""
Scientific core regression tests (route (c), J4 bulk == per-SKU, J5 backtest, C3-OUT observed availability).
Each test would have caught the corresponding review bug (P-01, P-02, P-14, P-23, R-10, R-13, B-06, ...).
"""
import unittest
from datetime import date, datetime, timedelta, timezone

import numpy as np
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.base import Base
from app.models.calibration_state import CalibrationState
from app.models.classification import SKUClassification
from app.models.forecast import Forecast
from app.models.forecast_backtest import ForecastBacktest
from app.models.inventory_daily import InventoryDaily
from app.models.inventory import Inventory
from app.models.inventory_param import InventoryParam
from app.models.policy_selection import PolicySelection
from app.models.product import Product
from app.models.sales_history import SalesHistory
from app.models.sim_clock import SimClock
from app.services import policy_backtest as pb
from app.services import policy_config as pc
from app.services.calibrator_service import calibrator_service
from app.services.optimization_service import optimization_service
from app.services.window_quantile_service import window_quantile_service

STORE = "CA_1"


def _session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)()


class TestRouteCResiduals(unittest.TestCase):
    def setUp(self):
        self.db = _session()
        self.o_idx = 1700
        self.origin = pc.day_index_to_date(self.o_idx)
        self.item = "FOODS_1_001"
        self.reviews = [self.o_idx - pc.HORIZON_DAYS - 7 * k for k in range(12)]
        for i, r in enumerate(self.reviews):
            self.db.add(ForecastBacktest(id=f"fb_{i}", store_id=STORE, item_id=self.item, review_day=r,
                                         dhat=20.0, dhat_lgb=20.0, sigma_d=1.0, model_run="backtest-ensemble-v1"))
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def _sales(self, days, qty):
        for d in days:
            self.db.add(SalesHistory(id=f"s_{d}", item_id=self.item, store_id=STORE,
                                     sale_date=pc.day_index_to_date(d), quantity=qty))
        self.db.commit()

    def test_missing_sales_days_are_never_treated_as_zero(self):
        """P-01: no sales at all -> no residual windows (the old code used r = 0 - F_hat and gave Q_hat < F_hat)."""
        res = window_quantile_service.collect_historical_residuals(
            self.db, item_id=self.item, store_id=STORE, origin_date=self.origin, horizon_days=10)
        self.assertEqual(len(res), 0)
        rec = window_quantile_service.build_records(self.db, STORE, [self.item], self.origin, 10)[0]
        self.assertEqual(rec.route, pc.ROUTE_FALLBACK)  # honest label: Gaussian fallback

    def test_only_complete_windows_are_used(self):
        # actuals only for the 3 oldest reviews' windows: just those residuals exist
        days = set()
        for r in self.reviews[-3:]:
            days.update(range(r, r + 10))
        self._sales(sorted(days), 3.0)
        res = window_quantile_service.collect_historical_residuals(
            self.db, item_id=self.item, store_id=STORE, origin_date=self.origin, horizon_days=10)
        self.assertEqual(len(res), 3)
        np.testing.assert_allclose(res, 30.0 - 20.0)

    def test_quantile_not_below_point_forecast_when_actuals_exceed_forecast(self):
        self._sales(range(self.o_idx - 200, self.o_idx), 3.0)  # window sums 30 > F_hat 20
        for h in range(1, 11):
            self.db.add(Forecast(id=f"f{h}", item_id=self.item, store_id=STORE,
                                 forecast_date=self.origin + timedelta(days=h - 1), h=h, y_pred=2.0, p10=1, p50=2,
                                 p90=3, available=True, model_version="Ensemble bundle 1.0"))
        self.db.commit()
        rec = window_quantile_service.build_records(self.db, STORE, [self.item], self.origin, 10)[0]
        self.assertEqual(rec.route, pc.ROUTE_EMPIRICAL)
        self.assertAlmostEqual(rec.point_window, 20.0, places=2)
        self.assertGreaterEqual(rec.q_levels["0.95"], rec.point_window)
        self.assertAlmostEqual(rec.q_levels["0.95"], 30.0, places=2)  # F_hat + quantile(residuals = 10)

    def test_non_ensemble_forecasts_never_feed_f_hat(self):
        """P-24: SBA / fast-inference rows must not become F_hat."""
        for h in range(1, 11):
            self.db.add(Forecast(id=f"x{h}", item_id=self.item, store_id=STORE,
                                 forecast_date=self.origin + timedelta(days=h - 1), h=h, y_pred=100.0, p10=1, p50=2,
                                 p90=3, available=True, model_version="fast-inference-sba"))
        self.db.commit()
        pt = window_quantile_service.compute_point_window_forecast(
            self.db, self.item, STORE, self.origin, 10)
        self.assertLess(pt, 100.0)

    def test_causal_matrix_uses_only_matured_origins(self):
        self._sales(range(self.o_idx - 300, self.o_idx + 30), 3.0)
        s_k = self.reviews[0]  # latest review
        cm = window_quantile_service.causal_quantile_matrix(self.db, STORE, [self.item], [s_k], 0.95)
        n_expected = len([r for r in self.reviews if r + 10 <= s_k])
        self.assertEqual(int(cm["n_res"][0, 0]), n_expected)


class TestBulkEqualsPerSku(unittest.TestCase):
    """P-02: the bulk recompute and the per-SKU path are ONE computation."""

    def setUp(self):
        self.db = _session()
        self.o_idx = 1700
        self.origin = pc.day_index_to_date(self.o_idx)
        self.db.add(SimClock(store_id=STORE, current_date=self.origin, start_date=self.origin))
        self.items = [f"FOODS_1_{i:03d}" for i in range(1, 15)]
        for n, it in enumerate(self.items):
            self.db.add(Product(item_id=it, name=it, cat_id="FOODS", price=2.0 + n))
            self.db.add(SKUClassification(id=f"c_{it}", item_id=it, store_id=STORE, abc_class="A",
                                          xyz_class="X" if n % 2 else "Y", segment="AX" if n % 2 else "AY"))
            for h in range(1, 11):
                self.db.add(Forecast(id=f"f_{it}_{h}", item_id=it, store_id=STORE,
                                     forecast_date=self.origin + timedelta(days=h - 1), h=h, y_pred=1.0 + n,
                                     p10=1, p50=1, p90=2, available=True, model_version="Ensemble bundle 1.0"))
            for k in range(12):
                self.db.add(ForecastBacktest(id=f"b_{it}_{k}", store_id=STORE, item_id=it,
                                             review_day=self.o_idx - 10 - 7 * k, dhat=10.0 + 10 * n, dhat_lgb=1.0,
                                             sigma_d=1.0, model_run="backtest-ensemble-v1"))
            for d in range(self.o_idx - 120, self.o_idx):
                self.db.add(SalesHistory(id=f"s_{it}_{d}", item_id=it, store_id=STORE,
                                         sale_date=pc.day_index_to_date(d), quantity=1.0 + n + (d % 3)))
        now = datetime.now(timezone.utc)
        for seg, m in (("AX", 0.0), ("AY", 0.0)):
            self.db.add(PolicySelection(selection_id="quarter_old", class_id=seg, m_g=m, kappa_g=2.0,
                                        setpoint=0.95, created_at=now - timedelta(days=30)))
            self.db.add(PolicySelection(selection_id="quarter_new", class_id=seg, m_g=m, kappa_g=1.0,
                                        setpoint=0.95, created_at=now))
        for k, th in ((1, 0.1), (2, 0.5)):  # latest review_index must win
            for seg in ("AX", "AY"):
                self.db.add(CalibrationState(id=f"{STORE}_{seg}_rev_{k}", calibrator_id="c", store_id=STORE,
                                             class_id=seg, review_index=k,
                                             review_date=self.origin - timedelta(days=14 - 7 * k), theta=th,
                                             multiplier=1.0))
        # a state dated AFTER the simulated clock must be ignored
        self.db.add(CalibrationState(id=f"{STORE}_AX_rev_9", calibrator_id="c", store_id=STORE, class_id="AX",
                                     review_index=9, review_date=self.origin + timedelta(days=60), theta=2.0,
                                     multiplier=1.0))
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_bulk_rows_equal_per_sku_rows(self):
        n = optimization_service.recompute_parameters(self.db, store_id=STORE)
        self.assertEqual(n, len(self.items))
        bulk = {r.item_id: r for r in self.db.query(InventoryParam).filter(InventoryParam.store_id == STORE)}
        cfg = optimization_service.get_service_level_config(self.db)
        for it in self.items:
            prod = self.db.query(Product).filter(Product.item_id == it).first()
            single = optimization_service._compute_params_batch(self.db, [prod], STORE, cfg)[0]
            self.assertEqual(single["s"], bulk[it].s, it)
            self.assertEqual(single["S"], bulk[it].S, it)
            self.assertEqual(single["eoq"], bulk[it].eoq, it)
            self.assertEqual(single["source"], bulk[it].source)
            self.assertEqual(bulk[it].lead_time_days, 3)

    def test_latest_theta_newest_policy_and_future_state_ignored(self):
        thetas = calibrator_service.get_current_thetas(self.db, STORE, as_of=self.origin)
        self.assertAlmostEqual(thetas["AX"], 0.5)  # rev 2, not rev 1, and not the future rev 9
        pol = calibrator_service.resolve_policies(self.db, STORE)
        self.assertEqual(pol["AX"].selection_id, "quarter_new")  # P-23: newest row wins
        self.assertEqual(pol["AX"].kappa_g, 1.0)

    def test_s_uses_q_hat_times_exp_m_plus_theta_once(self):
        optimization_service.recompute_parameters(self.db, store_id=STORE)
        rec = self.db.query(InventoryParam).filter(InventoryParam.item_id == self.items[1]).first()  # AX
        from app.models.forecast_window_quantile import ForecastWindowQuantile
        q = self.db.query(ForecastWindowQuantile).filter(
            ForecastWindowQuantile.item_id == self.items[1], ForecastWindowQuantile.origin_date == self.origin).first()
        q95 = q.q_levels["0.95"]
        self.assertEqual(rec.s, float(np.ceil(q95 * np.exp(0.0 + 0.5))))  # m_g = 0, theta = 0.5 applied once

    def test_override_set_recompute_in_bulk(self):
        n = optimization_service.recompute_parameters(self.db, store_id=STORE, item_ids=self.items[:3])
        self.assertEqual(n, 3)
        self.assertEqual(self.db.query(InventoryParam).count(), 3)


class TestPolicyBacktestJ5(unittest.TestCase):
    def _case(self, n_items=40, K=12, seed=0):
        rng = np.random.default_rng(seed)
        R = pc.REVIEW_PERIOD_DAYS
        dem = rng.poisson(3.0, size=(n_items, K * R)).astype(float)
        price = np.full(n_items, 5.0)
        # Q_hat of the protection window (10 days): the true mean is 30, take a decent quantile
        q = np.full((n_items, K), 38.0)
        eoq = np.full((n_items, K), 20.0)
        return dem, q, eoq, price

    def test_availability_increases_with_m_and_cost_has_a_minimum(self):
        dem, q, eoq, price = self._case()
        res = pb.simulate_rss_candidates(dem, q, eoq, price, [-0.7, -0.3, 0.0, 0.5, 1.5], [1.0])
        self.assertTrue(np.all(np.diff(res.availability) >= -1e-9))
        self.assertLess(res.availability[0], res.availability[-1])
        # at m = 1.5 stock is far above need: holding dominates, more expensive than m = 0
        self.assertGreater(res.cost[-1], res.cost[2])

    def test_picks_cheaper_feasible_candidate(self):
        dem, q, eoq, price = self._case()
        res = pb.simulate_rss_candidates(dem, q, eoq, price, list(pc.M_GRID), [0.5, 1.0, 2.0])
        target = 0.90
        best = pb.select_candidate(res, target, guard=0.01)
        self.assertTrue(best["is_feasible"])
        self.assertGreaterEqual(best["availability"], target + 0.01)
        feas = res.availability >= target + 0.01
        self.assertAlmostEqual(best["cost"], float(res.cost[feas].min()))
        # every cheaper candidate is infeasible
        self.assertTrue(np.all(res.availability[res.cost < best["cost"] - 1e-9] < target + 0.01))

    def test_infeasible_target_is_flagged_and_returns_most_available(self):
        dem, q, eoq, price = self._case()
        res = pb.simulate_rss_candidates(dem, q, eoq, price, [0.0, 0.5], [0.5])
        best = pb.select_candidate(res, target_availability=1.0, guard=0.01)
        self.assertFalse(best["is_feasible"])
        self.assertAlmostEqual(best["availability"], float(res.availability.max()))

    def test_availability_definition_is_observed_not_lost_sales(self):
        """A period where stock reaches exactly 0 without lost sales is UNAVAILABLE (§8.1)."""
        R = pc.REVIEW_PERIOD_DAYS
        # P1 G-01: the cycle of review 0 is days L .. L+R-1 and is scored only when complete, so the replay needs
        # two reviews (2R days) to contain one complete cycle
        dem = np.zeros((1, 2 * R))
        dem[0, 0] = 10.0  # sells exactly the initial stock on day 1
        res = pb.simulate_rss_candidates(dem, np.array([[10.0, 10.0]]), np.array([[1.0, 1.0]]), np.array([1.0]),
                                         [0.0], [0.0], initial_on_hand=np.array([10.0]))
        self.assertEqual(res.n_cycles, 1)
        self.assertEqual(res.availability[0], 0.0)
        self.assertEqual(res.shortage[0], 0.0)  # no lost sales at all

    def test_refit_with_real_backtest_returns_measured_metrics(self):
        db = _session()
        try:
            o_idx = 1700
            db.add(SimClock(store_id=STORE, current_date=pc.day_index_to_date(o_idx),
                            start_date=pc.day_index_to_date(o_idx)))
            items = [f"FOODS_1_{i:03d}" for i in range(1, 9)]
            reviews = [o_idx - 7 - 7 * k for k in range(0, 40)]
            rng = np.random.default_rng(3)
            for it in items:
                db.add(Product(item_id=it, name=it, cat_id="FOODS", price=4.0))
                db.add(SKUClassification(id=f"c_{it}", item_id=it, store_id=STORE, abc_class="A", xyz_class="X",
                                         segment="AX"))
                for k, r in enumerate(reviews):
                    db.add(ForecastBacktest(id=f"b_{it}_{k}", store_id=STORE, item_id=it, review_day=r, dhat=30.0,
                                            dhat_lgb=1.0, sigma_d=1.5, model_run="backtest-ensemble-v1"))
                for d in range(min(reviews) - 5, o_idx + 20):
                    db.add(SalesHistory(id=f"s_{it}_{d}", item_id=it, store_id=STORE,
                                        sale_date=pc.day_index_to_date(d), quantity=float(rng.poisson(3.0))))
            db.commit()
            res = optimization_service.refit_quarterly_policies(db, store_id=STORE, target_availability=0.90,
                                                                c3out_active=False)
            ax = next(r for r in res if r["class_id"] == "AX")
            self.assertIsNotNone(ax["val_service"])
            self.assertIsNotNone(ax["val_cost"])
            self.assertGreater(ax["n_validation_reviews"], 5)
            self.assertIn(ax["m_g"], pc.M_GRID)
            self.assertGreaterEqual(ax["kappa_g"], 0.5)
            if ax["is_feasible"]:
                self.assertGreaterEqual(ax["val_service"], 0.90 + pc.GUARD - 1e-9)
            # P6 active: m_g held at 0 (no double application with theta); setpoint = A_g + guard (research 8.2)
            res2 = optimization_service.refit_quarterly_policies(db, store_id=STORE, selection_id="p6",
                                                                 target_availability=0.95, c3out_active=True)
            ax2 = next(r for r in res2 if r["class_id"] == "AX")
            self.assertEqual(ax2["m_g"], 0.0)
            self.assertAlmostEqual(ax2["setpoint"], 0.96)  # Q-06: A_g + guard
        finally:
            db.close()


class TestCalibratorObservedAvailability(unittest.TestCase):
    def test_stockout_day_without_lost_sales_counts_as_unavailable(self):
        db = _session()
        try:
            end = date(2016, 5, 15)
            for it in ("A1", "A2"):
                db.add(SKUClassification(id=f"c_{it}", item_id=it, store_id=STORE, abc_class="A", xyz_class="X",
                                         segment="AX"))
                db.add(Inventory(item_id=it, store_id=STORE, on_hand=1.0, on_order=0.0))
            # A1 ended one day at 0 with NO lost sales; A2 never hit 0
            db.add(InventoryDaily(store_id=STORE, item_id="A1", date=end - timedelta(days=2), on_hand_end=0.0,
                                  lost_sales=0.0, stockout=False))
            db.add(InventoryDaily(store_id=STORE, item_id="A2", date=end - timedelta(days=2), on_hand_end=5.0,
                                  lost_sales=0.0, stockout=False))
            db.commit()
            outs = calibrator_service.record_cycle_outcome(db, store_id=STORE, cycle_index=1,
                                                           cycle_start=end - timedelta(days=6), cycle_end=end)
            ax = next(o for o in outs if o.class_id == "AX")
            self.assertEqual(ax.n_sku, 2)
            self.assertEqual(ax.n_stockout, 1)
            self.assertAlmostEqual(ax.error_rate, 0.5)
        finally:
            db.close()


class TestCompareCostsComplete(unittest.TestCase):
    def test_compare_charges_holding_shortage_and_ordering(self):
        db = _session()
        try:
            db.add(Product(item_id="FOODS_1_001", name="x", cat_id="FOODS", price=3.0))
            db.add(InventoryParam(id=f"{STORE}_FOODS_1_001", item_id="FOODS_1_001", store_id=STORE,
                                  service_level=0.95, lead_time_days=3, safety_stock=8.0, reorder_point=20.0,
                                  eoq=15.0, s=20.0, S=35.0, annual_demand=730.0, holding_cost=2.19,
                                  order_cost=2.0, unit_price=3.0, source="ml"))
            for d in range(1, 60):
                db.add(SalesHistory(id=f"s{d}", item_id="FOODS_1_001", store_id=STORE,
                                    sale_date=date(2026, 1, 1) + timedelta(days=d), quantity=2.0 + (d % 4)))
            db.commit()
            res = optimization_service.compare_ml_vs_static(db, store_id=STORE)
            it = res.items[0]
            for f in ("ml_annual_shortage_cost", "ml_annual_ordering_cost", "ml_annual_total_cost",
                      "static_annual_shortage_cost", "static_annual_ordering_cost", "static_annual_total_cost"):
                self.assertIsNotNone(getattr(it, f), f)
            self.assertGreater(it.ml_annual_ordering_cost, 0.0)
            self.assertGreaterEqual(it.ml_annual_shortage_cost, 0.0)
            self.assertIsNotNone(res.total_cost_savings)
        finally:
            db.close()


class TestHonestLabels(unittest.TestCase):
    def test_gbdt_aliases_are_not_presented_as_two_libraries(self):
        from app.schemas.ml_training import MODEL_ALIASES, MODEL_IMPLEMENTATION, SUPPORTED_MODELS
        self.assertEqual(MODEL_ALIASES["lightgbm"], "gbdt_lags")
        self.assertEqual(MODEL_ALIASES["xgboost"], "gbdt_trend")
        self.assertIn("pure numpy", MODEL_IMPLEMENTATION["gbdt_lags"])
        self.assertIn("pure numpy", MODEL_IMPLEMENTATION["gbdt_trend"])
        self.assertIn("gbdt_lags", SUPPORTED_MODELS)

    def test_future_forecast_labels_sba_fallback(self):
        from app.services.predictor_service import DFIOSPredictor
        db = _session()
        try:
            for d in range(1, 40):
                db.add(SalesHistory(id=f"s{d}", item_id="Z1", store_id=STORE,
                                    sale_date=date(2016, 1, 1) + timedelta(days=d), quantity=float(d % 3)))
            db.commit()
            import pandas as pd
            p = DFIOSPredictor()
            recs = p.predict_sku_future("Z1", STORE, 5, df_production_source=pd.DataFrame(), db=db)
            self.assertEqual(recs[0]["source"], "sba_fallback")
            self.assertNotIn("dfios_forecast", recs[0]["model_version"])
            none = p.predict_sku_future("NOPE", STORE, 3, df_production_source=pd.DataFrame(), db=db)
            self.assertFalse(none[0]["available"])
            self.assertEqual(none[0]["model_version"], "no-forecast")
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
