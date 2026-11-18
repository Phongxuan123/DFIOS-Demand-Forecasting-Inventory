"""
P1 policy alignment (Tier 2 J5 and Tier 3 C3-OUT J4/J6) against the teacher's reference engine
``app.services.e10b_replay`` (which reproduces Table 17 / E9c exactly; tests/test_e10b_regression.py).

1. A synthetic panel (40 SKUs, 3 classes, ~400 days) is loaded into SQLite. DFIOS J5 (``refit_quarterly_policies``)
   must pick, per class, the SAME (m, kappa) as ``e10b_replay.select_per_window`` run on the same inputs (demand,
   price, the same causal Q_hat(0.95), EOQ from the 56-day sales mean, initial stock from 28 days, one continuous
   simulation per candidate, 182-day window ending at the refit day, guard 0.96), and the per-candidate window
   costs / CSL must be equal.
2. J6 + J4 (``record_cycle_outcome`` + ``run_calibration_step``) on a hand-made stock-out sequence must give the
   same theta path as ``e10b_replay.c3_update`` (one-sided, theta_0 = 0, eta 1, setpoint 0.96, d = ceil((L+R)/R)).
3. Config / quantile switches: grids, flags off by default, linear tau interpolation.
"""
import math
from datetime import date, timedelta

import numpy as np
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.classification import SKUClassification
from app.models.forecast_backtest import ForecastBacktest
from app.models.inventory import Inventory
from app.models.inventory_daily import InventoryDaily
from app.models.policy_selection import PolicySelection
from app.models.product import Product
from app.models.sales_history import SalesHistory
from app.models.sim_clock import SimClock
from app.services import e10b_replay as er
from app.services import policy_config as pc
from app.services.calibrator_service import calibrator_service
from app.services.optimization_service import optimization_service
from app.services.window_quantile_service import (
    WindowQuantileService,
    residual_quantiles,
    window_quantile_service,
)

STORE = "CA_1"
L, R = pc.LEAD_TIME_DAYS, pc.REVIEW_PERIOD_DAYS
O_IDX = 1700                    # refit day (clock)
SALES_START = O_IDX - 400       # ~400 days of sales
FIRST_REVIEW = SALES_START + 56  # simulation start (first backtest review)
CLASSES = {"AX": 14, "BY": 13, "CZ": 13}
RATE = {"AX": 6.0, "BY": 2.0, "CZ": 0.4}


def _session():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng)()


@pytest.fixture(scope="module")
def panel():
    rng = np.random.default_rng(2026)
    db = _session()
    items, groups = [], []
    for g, (cls, n) in enumerate(CLASSES.items()):
        for i in range(n):
            items.append(f"{cls}_{i:02d}")
            groups.append(g)
    n = len(items)
    rate = np.array([RATE[list(CLASSES)[g]] for g in groups]) * rng.uniform(0.6, 1.4, n)
    price = np.round(rng.uniform(1.0, 12.0, n), 2)
    days = np.arange(SALES_START, O_IDX)
    if True:  # intermittent CZ demand, smoother AX
        y = rng.poisson(rate[:, None] * rng.gamma(4.0, 0.25, (n, len(days))))
    db.add(SimClock(store_id=STORE, current_date=pc.day_index_to_date(O_IDX),
                    start_date=pc.day_index_to_date(SALES_START)))
    reviews = list(range(FIRST_REVIEW, O_IDX - R + 1, R))
    prods, cls_rows, bt, sales = [], [], [], []
    for i, it in enumerate(items):
        cls = list(CLASSES)[groups[i]]
        prods.append(dict(item_id=it, name=it, cat_id="FOODS", price=float(price[i])))
        cls_rows.append(dict(id=f"c_{it}", item_id=it, store_id=STORE, abc_class=cls[0], xyz_class=cls[1],
                             segment=cls))
        for k, r in enumerate(reviews):
            bt.append(dict(id=f"b_{it}_{k}", store_id=STORE, item_id=it, review_day=r,
                           dhat=float(10.0 * rate[i] * rng.uniform(0.7, 1.3)), dhat_lgb=0.0, sigma_d=1.0,
                           model_run="backtest-ensemble-v1"))
        for j, d in enumerate(days):
            sales.append(dict(id=f"s_{it}_{d}", item_id=it, store_id=STORE, sale_date=pc.day_index_to_date(int(d)),
                              quantity=float(y[i, j])))
    db.bulk_insert_mappings(Product, prods)
    db.bulk_insert_mappings(SKUClassification, cls_rows)
    db.bulk_insert_mappings(ForecastBacktest, bt)
    db.bulk_insert_mappings(SalesHistory, sales)
    db.commit()
    yield dict(db=db, items=items, groups=np.array(groups), y=y.astype(float), price=price, reviews=reviews)
    db.close()


def _reference(panel):
    """e10b_replay on the same inputs: y/price from day SALES_START, VAL_START = first review, one selection window
    (max(VAL, a - 182), a) with a = end of the last complete review period."""
    db, items = panel["db"], panel["items"]
    reviews = panel["reviews"]
    end = reviews[-1] + R
    base = SALES_START
    cm = window_quantile_service.causal_quantile_matrix(db, STORE, items, reviews, pc.QUANTILE_TAU, L + R)
    assert not np.isnan(cm["q"]).any()
    cfg = er.ReplayConfig(L=L, R=R, VAL_START=FIRST_REVIEW - base, TEST_START=end - base, T=end - base,
                          m_grid=tuple(pc.M_GRID), kappa_grid_eoq=tuple(pc.KAPPA_GRID),
                          n_quarters=1, quarter_len=pc.REFIT_PERIOD_DAYS,
                          selection_lookback=pc.SELECTION_WINDOW_DAYS, guard=pc.SELECTION_GUARD_AVAILABILITY,
                          eoq_window=pc.EOQ_MEAN_WINDOW_DAYS, init_window=pc.INIT_STOCK_WINDOW_DAYS)
    y = panel["y"][:, :end - base]
    price = np.repeat(panel["price"][:, None], y.shape[1], axis=1)
    names = list(CLASSES)
    inputs = er.ReplayInputs(y=y, price=price, groups=panel["groups"], class_names=names, q=cm["q"].T.copy(),
                             review_days=cfg.review_days, L=L, R=R)
    assert np.array_equal(cfg.review_days + base, np.array(reviews))
    stats = er.evaluate_candidates(inputs, cfg, "REFIT-RSS-EOQ-G")
    chosen = er.select_per_window(stats, cfg)[0]
    return stats, chosen, cfg, names


def test_j5_selection_equals_teacher_choose(panel):
    stats, chosen, cfg, names = _reference(panel)
    assert cfg.selection_windows[0][0] > cfg.VAL_START  # the window has a warm-up prefix (continuous simulation)
    db = panel["db"]
    for g, cls in enumerate(names):
        sc, n_items, reviews = optimization_service.evaluate_class_candidates(db, STORE, cls, O_IDX)
        assert n_items == CLASSES[cls]
        assert reviews[0] == FIRST_REVIEW
        keys = list(zip(sc["m"].tolist(), sc["kappa"].tolist()))
        assert keys == [(float(m), float(k)) for m, k in stats.keys]  # same 140 candidates, same order
        np.testing.assert_allclose(sc["cost"], stats.costs[:, 0, g], rtol=1e-9, atol=1e-6)
        np.testing.assert_allclose(sc["availability"], stats.csl[:, 0, g], rtol=0, atol=1e-12)
        best = optimization_service.choose_candidate(sc)
        j = er.choose(stats.costs[:, 0, g], stats.csl[:, 0, g], cfg.guard)
        assert best["index"] == j

    res = optimization_service.refit_quarterly_policies(db, store_id=STORE, selection_id="p1_check")
    by_cls = {r["class_id"]: r for r in res}
    n_feasible = 0
    for g, cls in enumerate(names):
        r = by_cls[cls]
        assert r["search_mode"] == "m_grid"
        assert (r["m_g"], r["kappa_g"]) == (chosen["m"][g], chosen["kappa"][g]), cls
        n_feasible += bool(r["is_feasible"])
        row = db.query(PolicySelection).filter(PolicySelection.selection_id == f"{STORE}_p1_check",
                                               PolicySelection.class_id == cls).one()
        assert (row.m_g, row.kappa_g, row.setpoint) == (chosen["m"][g], chosen["kappa"][g], 0.96)
    assert n_feasible >= 1
    # classes without SKUs keep the neutral, explicitly infeasible policy
    assert by_cls["BZ"]["val_cost"] is None and by_cls["BZ"]["is_feasible"] is False


def test_j5_kappa_only_is_an_explicit_ablation(panel):
    stats, _, cfg, names = _reference(panel)
    res = optimization_service.refit_quarterly_policies(panel["db"], store_id=STORE, selection_id="abl",
                                                        search_mode="kappa_only")
    by_cls = {r["class_id"]: r for r in res}
    m0 = np.array([k[0] == 0.0 for k in stats.keys])
    for g, cls in enumerate(names):
        idx = np.flatnonzero(m0)
        j = idx[er.choose(stats.costs[idx, 0, g], stats.csl[idx, 0, g], cfg.guard)]
        assert by_cls[cls]["m_g"] == 0.0 and by_cls[cls]["search_mode"] == "kappa_only"
        assert by_cls[cls]["kappa_g"] == stats.keys[j][1]


def test_c3_one_sided_matches_reference_on_handmade_stockouts():
    db = _session()
    try:
        t0 = date(2016, 1, 4)
        cls_items = {"AX": [f"AX_{i}" for i in range(5)], "CZ": [f"CZ_{i}" for i in range(4)]}
        for cls, its in cls_items.items():
            for it in its:
                db.add(Product(item_id=it, name=it, cat_id="FOODS", price=1.0))
                db.add(Inventory(item_id=it, store_id=STORE, on_hand=1.0, on_order=0.0))
                db.add(SKUClassification(id=f"c_{it}", item_id=it, store_id=STORE, abc_class=cls[0],
                                         xyz_class=cls[1], segment=cls))
                # same item in another store must not count (class filter by store_id)
                db.add(SKUClassification(id=f"o_{it}", item_id=it, store_id="TX_1", abc_class=cls[0],
                                         xyz_class=cls[1], segment=cls))
        db.commit()
        # hand-made stock-outs per cycle j: number of failing SKUs of AX (of 5) and CZ (of 4)
        fails = {"AX": [0, 1, 3, 5, 5, 2, 0, 0, 1, 0, 0, 4], "CZ": [4, 4, 0, 1, 0, 0, 0, 2, 0, 0, 3, 0]}
        n_cycles = len(fails["AX"])
        d = math.ceil((L + R) / R)
        cfg = er.ReplayConfig(L=L, R=R)
        theta_ref = np.zeros(2)
        e_hist = []
        for j in range(n_cycles):
            c_start = t0 + timedelta(days=j * R + L)
            c_end = c_start + timedelta(days=R - 1)
            for cls, its in cls_items.items():
                for i, it in enumerate(its):
                    # failing SKU: one day of the cycle ends with on-hand 0 (no lost sale needed)
                    oh = 0.0 if i < fails[cls][j] else 3.0
                    db.add(InventoryDaily(store_id=STORE, item_id=it, date=c_start + timedelta(days=j % R),
                                          on_hand_end=oh, lost_sales=0.0, stockout=False))
                    # a stock-out OUTSIDE the cycle window never counts
                    db.add(InventoryDaily(store_id=STORE, item_id=it, date=c_start - timedelta(days=L + 1 + 100),
                                          on_hand_end=0.0, lost_sales=0.0, stockout=False))
            db.commit()
            calibrator_service.record_cycle_outcome(db, store_id=STORE, cycle_index=j, cycle_start=c_start,
                                                    cycle_end=c_end)
            e_hist.append(np.array([fails["AX"][j] / 5, fails["CZ"][j] / 4]))
        thetas = {"AX": [], "CZ": []}
        ref = []
        for k in range(1, n_cycles + d):
            states, _, consumed = calibrator_service.run_calibration_step(
                db, store_id=STORE, review_index=k, review_date=t0 + timedelta(days=k * R),
                lead_time_days=L, review_period_days=R)
            assert consumed == k - d
            if 0 <= k - d < n_cycles:
                theta_ref = er.c3_update(theta_ref, e_hist[k - d], cfg)
            ref.append(theta_ref.copy())
            st = {s.class_id: s for s in states}
            thetas["AX"].append(st["AX"].theta)
            thetas["CZ"].append(st["CZ"].theta)
            assert st["AX"].status == ("Warm-up" if k - d < 0 else
                                       ("Boundary" if st["AX"].theta >= 2.0 else "Active"))
            assert st["AX"].at_boundary == (st["AX"].theta >= 2.0)
        ref = np.array(ref)
        np.testing.assert_allclose(thetas["AX"], ref[:, 0], atol=1e-12)
        np.testing.assert_allclose(thetas["CZ"], ref[:, 1], atol=1e-12)
        assert min(thetas["AX"] + thetas["CZ"]) >= 0.0  # one-sided
        assert max(thetas["AX"]) > 0.5  # the sequence actually moved theta
        # theta is added on top of m_g in the online parameters
        assert calibrator_service.get_current_thetas(db, STORE)["AX"] == pytest.approx(ref[-1, 0])
    finally:
        db.close()


def test_policy_config_grids_match_teacher():
    assert len(pc.M_GRID) == 28 and pc.M_GRID[0] == -0.7 and pc.M_GRID[-1] == 2.0
    assert pc.M_GRID == list(er.ReplayConfig().m_grid)
    assert pc.KAPPA_GRID == list(er.ReplayConfig().kappa_grid_eoq)
    assert len(pc.M_GRID) * len(pc.KAPPA_GRID) == 140
    assert pc.SELECTION_WINDOW_DAYS == 182 and pc.SELECTION_GUARD_AVAILABILITY == 0.96
    assert (pc.THETA_MIN, pc.THETA_MAX, pc.C3_SETPOINT, pc.CONTROLLER_ETA, pc.THETA_INIT) == (0.0, 2.0, 0.96, 1.0, 0.0)
    assert pc.J5_SEARCH_MODE_DEFAULT == "m_grid"


def test_teacher_eoq_no_floor_no_rounding():
    eoq = optimization_service.teacher_eoq(np.array([0.0, 0.3, 5.0]), np.array([2.0, 2.0, 4.0]))
    assert eoq[0] == 0.0
    assert eoq[1] == pytest.approx(math.sqrt(2 * 2.0 * 0.3 / (0.002 * 2.0)))
    assert eoq[2] == pytest.approx(math.sqrt(2 * 2.0 * 5.0 / (0.002 * 4.0)))


def test_route_c_defaults_no_floor_no_fallback_and_linear_tau():
    assert pc.QUANTILE_FLOOR_ENABLED is False and pc.GAUSSIAN_FALLBACK_ENABLED is False
    # no floor: a tiny forecast with negative residuals stays below 1
    q = residual_quantiles(np.array([0.4]), np.array([[-0.3, -0.2, -0.1]]), [0.95])[0, 0]
    assert q < 1.0
    assert residual_quantiles(np.array([0.4]), np.array([[-0.3, -0.2, -0.1]]), [0.95], quantile_floor=1.0)[0, 0] == 1.0
    # few residuals (< MIN_RESIDUALS) still give the empirical quantile, no residual -> max(0, F_hat)
    d = window_quantile_service.calculate_quantiles_dict(5.0, np.array([1.0, 2.0]), [0.95])
    assert d["0.95"] == round(5.0 + float(np.quantile([1.0, 2.0], 0.95)), 2)
    assert window_quantile_service.calculate_quantiles_dict(5.0, np.array([]), [0.95])["0.95"] == 5.0
    fb = window_quantile_service.calculate_quantiles_dict(5.0, np.array([]), [0.95], gaussian_fallback=True)
    assert fb["0.95"] > 5.0
    # G-28: linear interpolation between stored levels, ends clamp
    qd = {"0.9": 10.0, "0.95": 20.0, "0.99": 40.0}
    assert WindowQuantileService.tau_value(qd, 0.95) == 20.0
    assert WindowQuantileService.tau_value(qd, 0.925) == pytest.approx(15.0)
    assert WindowQuantileService.tau_value(qd, 0.97) == pytest.approx(30.0)
    assert WindowQuantileService.tau_value(qd, 0.999) == 40.0


def test_choose_candidate_infeasible_branch_equals_teacher():
    sc = {"m": np.array([0.0, 0.5, 1.0, 1.5]), "kappa": np.array([1.0, 1.0, 1.0, 1.0]),
          "cost": np.array([10.0, 12.0, 11.0, 30.0]), "availability": np.array([0.90, 0.95, 0.95, np.nan]),
          "fill_rate": np.ones(4)}
    best = optimization_service.choose_candidate(sc)
    assert best["index"] == er.choose(sc["cost"], np.nan_to_num(sc["availability"], nan=-1.0), 0.96) == 2
    assert best["is_feasible"] is False
    sc["availability"][1] = 0.97
    assert optimization_service.choose_candidate(sc)["index"] == 1
