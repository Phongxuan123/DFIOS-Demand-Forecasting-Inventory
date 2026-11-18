"""
P1 simulation alignment with the teacher's reference simulator (DFIOS/experiments/rss.py, E10b; see
docs/teacher_map/00_INDEX.md §3 and the verified replay docs/teacher_map/replay_e10b_prototype.py).

The core check ports the loop of the reference replay into a tiny in-test implementation and asserts that the DFIOS
backtest engine (``policy_backtest.simulate_rss_candidates``) returns IDENTICAL costs, orders, fill and CSL on a
deterministic synthetic case (5 SKUs, 63 days = 9 weekly reviews, daily prices).
Teacher rules exercised: arrivals at the start of t + L before the review; IP = on-hand + pipeline arriving after
today; order iff IP < s (strict), q = S - IP; lost sales; holding on end-of-day stock x that day's price; service
cycle of review k = days t_k + L .. t_k + L + R - 1, complete cycles only, failure = a day ending with on-hand <= 0;
initial stock = round(mean of the previous 28 days x (L + R)).
"""
import math
import unittest
from datetime import date, timedelta

import numpy as np
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.inventory import Inventory
from app.models.inventory_param import InventoryParam
from app.models.product import Product
from app.models.replenishment import ReplenishmentRecommendation
from app.models.sales_history import SalesHistory
from app.models.sim_clock import SimClock
from app.services import policy_backtest as pb
from app.services.simulator_service import SimulatorService

H_, B_, C_ = 0.002, 0.35, 2.0


def reference_replay(y, price, q95, eoq, init, mult, kappa, L, R):
    """Single-candidate port of the teacher loop (replay_e10b_prototype.sim + window over the whole segment)."""
    n, T = y.shape
    K = q95.shape[1]
    oh = init.astype(float).copy()
    pipe = np.zeros((n, T + L + 2))
    hold = lost_v = 0.0
    orders = 0
    lost_u = 0.0
    Z = np.zeros((K, n), bool)
    for t in range(T):
        oh += pipe[:, t]
        if t % R == 0:
            k = t // R
            s = np.ceil(q95[:, k] * mult - 1e-9)
            batch = np.ceil(kappa * eoq[:, k] - 1e-9)
            ip = oh + pipe[:, t + 1:t + L].sum(1)
            q = np.where(ip < s, s + batch - ip, 0.0)
            q = np.maximum(q, 0)
            orders += int((q > 0).sum())
            pipe[:, t + L] += q
        D = y[:, t]
        sales = np.minimum(oh, D)
        lost = D - sales
        oh -= sales
        hold += float((oh * price[:, t]).sum())
        lost_v += float((lost * price[:, t]).sum())
        lost_u += float(lost.sum())
        if t >= L:
            kc = (t - L) // R
            if kc < K:
                Z[kc] |= oh <= 0
    review_days = np.arange(0, T, R)
    cyc = review_days + L + R - 1 < T
    csl = 1.0 - Z[cyc].mean(axis=1).mean()   # 1 - mean over complete cycles of the stock-out share
    cost = H_ * hold + B_ * lost_v + C_ * orders
    return {"cost": cost, "holding": H_ * hold, "shortage": B_ * lost_v, "ordering": C_ * orders,
            "orders": orders, "fill": 1.0 - lost_u / y.sum(), "csl": csl, "n_cycles": int(cyc.sum())}


def _case(seed=11, n=5, K=9, R=7):
    rng = np.random.default_rng(seed)
    T = K * R
    lam = np.array([0.4, 1.5, 3.0, 6.0, 0.0])[:n]               # incl. an intermittent and a dead SKU
    y = rng.poisson(lam[:, None], size=(n, T)).astype(float)
    hist = rng.poisson(lam[:, None], size=(n, 40)).astype(float)
    price = np.round(rng.uniform(1.0, 9.0, size=(n, 1)) * rng.uniform(0.9, 1.1, size=(n, T)), 2)
    q95 = np.round(lam[:, None] * 10 * rng.uniform(0.7, 1.4, size=(n, K)), 3)
    eoq = np.sqrt(2 * C_ * np.maximum(lam[:, None], 0) / (H_ * price[:, ::R]))   # real EOQ, may be 0
    return y, hist, price, q95, eoq


class TestBacktestMatchesTeacherReference(unittest.TestCase):
    def _check(self, L, R, m_values, kappa_values, theta=0.0, seed=11):
        y, hist, price, q95, eoq = _case(seed=seed, R=R)
        init = np.round(hist[:, -28:].mean(axis=1) * (L + R))
        res = pb.simulate_rss_candidates(
            y, q95, eoq, price[:, 0], m_values, kappa_values, theta=theta, lead_time=L, review_period=R,
            daily_price=price, history_demand=hist,
        )
        i = 0
        for m in m_values:
            for kap in kappa_values:
                ref = reference_replay(y, price, q95, eoq, init, math.exp(m + theta), kap, L, R)
                self.assertAlmostEqual(res.cost[i], ref["cost"], places=9)
                self.assertAlmostEqual(res.holding[i], ref["holding"], places=9)
                self.assertAlmostEqual(res.shortage[i], ref["shortage"], places=9)
                self.assertAlmostEqual(res.ordering[i], ref["ordering"], places=9)
                self.assertEqual(int(res.orders[i]), ref["orders"])
                self.assertAlmostEqual(res.fill_rate[i], ref["fill"], places=12)
                self.assertAlmostEqual(res.availability[i], ref["csl"], places=12)
                self.assertEqual(res.n_cycles, ref["n_cycles"])
                i += 1

    def test_identical_to_reference_L3_R7_grid(self):
        self._check(3, 7, [-0.7, -0.3, 0.0, 0.4, 1.0], [0.0, 0.5, 1.0, 2.0])

    def test_identical_to_reference_with_theta_and_other_seeds(self):
        for seed in (1, 2, 3):
            self._check(3, 7, [-0.2, 0.3], [0.0, 1.5], theta=0.25, seed=seed)

    def test_identical_to_reference_other_lead_times(self):
        self._check(1, 7, [0.0, 0.5], [0.0, 1.0])
        self._check(7, 7, [0.0, 0.5], [0.0, 1.0])
        self._check(3, 1, [0.0, 0.5], [0.0, 1.0])

    def test_cycle_count_complete_cycles_only(self):
        # 9 reviews, L = 3, R = 7, 63 days: the cycle of review 8 is days 59..65 -> incomplete -> 8 cycles
        self.assertEqual(pb.complete_cycles(63, 9, 3, 7), 8)
        self.assertEqual(pb.complete_cycles(63, 9, 0, 7), 9)


class TestTeacherRulesUnits(unittest.TestCase):
    def test_trigger_is_strict_ip_below_s(self):
        """IP == s never orders; s = 0 with IP = 0 never orders (G-02)."""
        R, L = 7, 3
        dem = np.zeros((2, 2 * R))
        q = np.array([[10.0, 10.0], [0.0, 0.0]])
        res = pb.simulate_rss_candidates(dem, q, np.ones((2, 2)), np.ones(2), [0.0], [1.0],
                                         initial_on_hand=np.array([10.0, 0.0]))
        self.assertEqual(int(res.orders[0]), 0)
        res2 = pb.simulate_rss_candidates(dem, q, np.ones((2, 2)), np.ones(2), [0.0], [1.0],
                                          initial_on_hand=np.array([9.0, 0.0]))
        self.assertEqual(int(res2.orders[0]), 1)        # 9 < 10: one order of S - IP = 11 - 9
        self.assertAlmostEqual(res2.ordering[0], 2.0)

    def test_service_cycle_is_shifted_by_lead_time(self):
        """A stock-out on days 0..L-1 belongs to no scored cycle; on day L it fails cycle 0 (G-01)."""
        R, L = 7, 3
        q = np.array([[0.0, 0.0]])
        eoq = np.zeros((1, 2))
        dem = np.zeros((1, 2 * R))
        dem[0, 0] = 5.0                                   # sells out on day 0 (before the cycle of review 0)
        res = pb.simulate_rss_candidates(dem, q, eoq, np.ones(1), [0.0], [0.0], initial_on_hand=np.array([5.0]),
                                         lead_time=L, review_period=R)
        # still at 0 on day L -> cycle 0 fails; cycle 1 (days 10..16) incomplete -> 1 cycle scored
        self.assertEqual(res.n_cycles, 1)
        self.assertEqual(res.availability[0], 0.0)
        res_ok = pb.simulate_rss_candidates(dem, q, eoq, np.ones(1), [0.0], [0.0], initial_on_hand=np.array([6.0]),
                                            lead_time=L, review_period=R)
        self.assertEqual(res_ok.availability[0], 1.0)

    def test_initial_stock_from_previous_28_days(self):
        hist = np.vstack([np.r_[np.full(12, 100.0), np.full(28, 2.0)], np.r_[np.zeros(39), 1.0]])
        np.testing.assert_array_equal(pb.initial_stock_from_history(hist, 3, 7), [20.0, round(10 / 28)])

    def test_b0_ma_out_order_up_to_formula(self):
        rng = np.random.default_rng(5)
        h = rng.poisson(2.5, size=(3, 70)).astype(float)
        S = SimulatorService.b0_ma_out_order_up_to(h, 3, 7)
        w = h[:, -56:]
        exp = np.ceil(w.mean(1) * 10 + 1.6448536269514722 * w.std(1, ddof=1) * math.sqrt(10) - 1e-9)
        np.testing.assert_array_equal(S, exp)
        self.assertTrue(np.all(SimulatorService.b0_ma_out_order_up_to(np.zeros((2, 0)), 3, 7) == 0))


def _repl_db(on_hand, s, S):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    db.add(Product(item_id="FOODS_1_001", name="x", cat_id="FOODS", dept_id="FOODS_1", price=3.0))
    db.add(Inventory(item_id="FOODS_1_001", store_id="CA_1", on_hand=on_hand, on_order=0.0))
    db.add(InventoryParam(id="CA_1_FOODS_1_001", item_id="FOODS_1_001", store_id="CA_1", safety_stock=0.0,
                          reorder_point=s, eoq=S - s, s=s, S=S))
    db.commit()
    return db


class TestReplenishmentStrictTrigger(unittest.TestCase):
    def _run(self, on_hand, s, S):
        from app.services.replenishment_service import replenishment_service
        db = _repl_db(on_hand, s, S)
        n = replenishment_service.generate_recommendations(db, store_id="CA_1", review_date=date(2016, 4, 25))
        rows = db.query(ReplenishmentRecommendation).all()
        return n, rows

    def test_ip_equal_s_does_not_order(self):
        n, rows = self._run(on_hand=5.0, s=5.0, S=9.0)
        self.assertEqual(n, 0)
        self.assertEqual(rows, [])

    def test_zero_s_zero_ip_never_orders(self):
        n, _ = self._run(on_hand=0.0, s=0.0, S=0.0)
        self.assertEqual(n, 0)

    def test_ip_below_s_orders_exactly_S_minus_IP(self):
        n, rows = self._run(on_hand=4.0, s=5.0, S=9.0)
        self.assertEqual(n, 1)
        self.assertEqual(rows[0].recommended_qty, 5.0)
        self.assertIn("IP (4.0) < s (5.0)", rows[0].reason)


class TestSimulatorInitialStock(unittest.TestCase):
    def test_initial_levels_use_previous_28_days(self):
        engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=engine)
        db = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
        start = date(2016, 4, 25)
        db.add(SimClock(store_id="CA_1", current_date=start, start_date=start))
        for i in range(1, 41):  # 40 days before the start: the last 28 have 3/day, the older ones 50/day
            db.add(SalesHistory(id=f"h{i}", item_id="A", store_id="CA_1", sale_date=start - timedelta(days=i),
                                quantity=3.0 if i <= 28 else 50.0))
        db.add(SalesHistory(id="fut", item_id="A", store_id="CA_1", sale_date=start, quantity=999.0))
        db.commit()
        lv = SimulatorService.initial_inventory_levels(db, "CA_1", ["A", "B"])
        np.testing.assert_array_equal(lv, [30.0, 0.0])   # round(3 x (3 + 7)); B sold nothing


if __name__ == "__main__":
    unittest.main()
