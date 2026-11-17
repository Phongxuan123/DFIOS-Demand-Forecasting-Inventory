"""Tests for app.services.e10b_replay.

(a) deterministic unit tests on tiny synthetic inputs (always run);
(b)/(c) regression against the teacher's E10b Table 17 and E9c numbers, skipped when the
teacher folder (env TEACHER_DIR, default C:\\DATN\\26FA_SET490_Inventory) is absent.
The teacher folder is only read.
"""
import os
import sys

sys.dont_write_bytecode = True

import numpy as np
import pytest

from app.services.e10b_replay import (
    ReplayConfig,
    ReplayInputs,
    c3_update,
    choose,
    cycle_days,
    eoq_base,
    initial_stock,
    load_teacher_inputs,
    load_teacher_selection,
    merge_small,
    mu_r_base,
    public_result,
    replay,
    simulate,
    teacher_dir_default,
)

# --------------------------------------------------------------------------- synthetic helpers
CFG = ReplayConfig(L=2, R=3, VAL_START=30, TEST_START=42, T=54, quarter_len=6, n_quarters=2,
                   selection_lookback=12, m_grid=(-0.2, 0.0, 0.5), kappa_grid_eoq=(0.0, 1.0),
                   kappa_grid_mu=(0.0, 1.0))


def _inputs(y, q, cfg=CFG, groups=None, price=None, names=None):
    y = np.asarray(y, dtype=float)
    n = y.shape[0]
    groups = np.zeros(n, dtype=np.int64) if groups is None else np.asarray(groups, dtype=np.int64)
    names = names or [f"G{i}" for i in range(int(groups.max()) + 1)]
    price = np.ones_like(y) if price is None else np.asarray(price, dtype=float)
    rd = cfg.review_days
    q = np.broadcast_to(np.asarray(q, dtype=float), (len(rd), n)).copy()
    return ReplayInputs(y=y, price=price, groups=groups, class_names=names, q=q, review_days=rd,
                        L=cfg.L, R=cfg.R, store_id=np.array(["S"] * n), item_id=np.arange(n).astype(str))


def _sim(inp, init, kappa=0.0, base=None, cfg=CFG, c3=False, m=0.0):
    K, G = len(inp.review_days), inp.G
    base = np.zeros((K, inp.n)) if base is None else base
    return simulate(inp, cfg, np.full((K, G), m), np.full((K, G), kappa), base, c3=c3,
                    init=np.asarray(init, dtype=float))


# --------------------------------------------------------------------------- (a) unit tests
def test_cycle_days_and_teacher_grid():
    cfg = ReplayConfig()
    assert list(cycle_days(1395, cfg)) == list(range(1398, 1405))
    assert len(cfg.m_grid) * len(cfg.kappa_grid_eoq) == 140
    assert cfg.m_grid[0] == -0.7 and cfg.m_grid[-1] == 2.0 and 0.0 in cfg.m_grid
    assert cfg.selection_windows == [(1395, 1577), (1486, 1668), (1577, 1759), (1668, 1850)]


def test_stockout_counted_only_inside_cycle_window():
    V, L, R = CFG.VAL_START, CFG.L, CFG.R
    y = np.zeros((3, CFG.T))
    y[0, V + L - 1] = 1  # out of stock on day t0+L-1, restocked on t0+L -> cycle 0 OK
    y[1, V + L + R - 1] = 3  # out of stock on last day of cycle 0
    y[2, V + L + R] = 3  # out of stock on first day of cycle 1
    q = np.zeros((len(CFG.review_days), 3))
    q[0, 0] = 2  # SKU 0 orders 1 unit at review 0 (IP=1 < s=2), arriving on t0+L
    inp = _inputs(y, 0.0)
    inp.q[:] = q
    tr = _sim(inp, init=[1, 3, 3])
    assert tr.orders[0, 0] == 1
    assert not tr.stockout[0, 0]
    assert tr.stockout[0, 1] and tr.stockout[1, 1]
    assert not tr.stockout[0, 2] and tr.stockout[1, 2]


def test_order_only_when_ip_strictly_below_s_and_up_to_s_plus_batch():
    y = np.zeros((2, CFG.T))
    inp = _inputs(y, [5.0, 5.5])  # s = 5 (== IP: no order) and s = 6 (> IP: order)
    K = len(inp.review_days)
    base = np.full((K, 2), 4.0)  # batch = ceil(0.5 * 4) = 2
    tr = _sim(inp, init=[5, 5], kappa=0.5, base=base)
    assert tr.orders[0, 0] == 1 and tr.orders[1:].sum() == 0
    L = CFG.L
    hv = tr.hold_value[:, 0]  # price 1 -> units on hand summed over the 2 SKUs
    assert hv[L - 1] == 10 and hv[L] == 5 + (6 + 2 - 5) + 5


def test_eoq_56_day_window_and_mu_r():
    rng = np.random.default_rng(0)
    y = rng.poisson(2.0, (3, 120)).astype(float)
    price = rng.uniform(1, 5, (3, 120))
    cfg = ReplayConfig(L=3, R=7, VAL_START=70, TEST_START=84, T=98)
    rd = np.array([70, 77])
    eoq = eoq_base(y, price, rd, cfg)
    for k, t in enumerate(rd):
        mu = y[:, t - 56:t].mean(1)
        np.testing.assert_allclose(eoq[k], np.sqrt(2 * 2.0 * mu / (0.002 * price[:, t])))
    np.testing.assert_allclose(mu_r_base(y, rd, cfg)[1], y[:, 77 - 28:77].mean(1) * 7)


def test_initial_stock_is_rounded_28_day_mean_times_L_plus_R():
    y = np.zeros((2, CFG.T))
    y[0, CFG.VAL_START - 28:CFG.VAL_START] = 1.0
    y[1, CFG.VAL_START - 28:CFG.VAL_START - 14] = 1.0  # mean 0.5
    y[1, CFG.VAL_START] = 100.0  # day VAL itself excluded
    np.testing.assert_array_equal(initial_stock(y, CFG), [5.0, 2.0])  # 0.5*5 = 2.5 -> 2 (half-even)


def test_choose_rule():
    # cheapest feasible
    assert choose([5, 3, 1], [0.97, 0.96, 0.95], 0.96) == 1
    # none feasible -> smallest shortfall, then cost
    assert choose([5, 3, 1], [0.95, 0.95, 0.90], 0.96) == 1
    assert choose([1, 2], [0.90, 0.94], 0.96) == 1


def test_c3_one_sided_clip_and_delay():
    cfg = CFG
    np.testing.assert_allclose(c3_update(np.zeros(3), np.array([0.0, 0.14, 1.0]), cfg), [0.0, 0.1, 0.96])
    np.testing.assert_allclose(c3_update(np.array([1.9]), np.array([1.0]), cfg), [2.0])
    y = np.zeros((1, CFG.T))
    inp = _inputs(y, 0.0)
    tr = _sim(inp, init=[0], c3=True)  # always out of stock -> e = 1
    d = cfg.c3_delay
    assert d == 2
    assert np.all(tr.theta[:d] == 0)
    assert tr.theta[d, 0] == pytest.approx(0.96) and tr.theta[-1, 0] == pytest.approx(2.0)


def test_merge_small_nearest_then_larger():
    labels = ["CX"] * 3 + ["CY"] * 20 + ["BX"] * 30 + ["AZ"] * 40
    out = merge_small(labels)
    assert (out[:3] == "BX").all()  # CY and BX both at distance 1; BX is larger
    assert sorted(set(out)) == ["AZ", "BX", "CY"]


def test_synthetic_replay_is_deterministic_and_has_teacher_shape():
    rng = np.random.default_rng(1)
    n = 12
    y = rng.poisson(1.5, (n, CFG.T)).astype(float)
    q = np.full((len(CFG.review_days), n), 8.0)
    inp = _inputs(y, q, groups=np.arange(n) % 2, names=["AX", "BY"])
    r1 = public_result(replay(inp, CFG, "REFIT-RSS-EOQ-G"))
    r2 = public_result(replay(inp, CFG, "REFIT-RSS-EOQ-G"))
    assert r1 == r2
    sch = r1["selection"]["schedule"]
    assert [s["start"] for s in sch] == [30, 42, 48]
    assert sch[2]["window"] == [36, 48] and "window" not in sch[0]
    assert set(sch[0]) == {"start", "m", "kappa", "feasible"}
    assert r1["cost"] == pytest.approx(r1["holding"] + r1["lost"] + r1["ordering"])
    assert r1["ordering"] == 2.0 * r1["orders"]
    single = public_result(replay(inp, CFG, "RSS-EOQ-G"))
    assert len(single["selection"]["schedule"]) == 1


# --------------------------------------------------------------------------- (b)/(c) teacher regression
TEACHER_DIR = teacher_dir_default()
needs_teacher = pytest.mark.skipif(not os.path.isdir(TEACHER_DIR), reason="teacher folder not available")


@pytest.fixture(scope="module")
def teacher_inputs():
    return load_teacher_inputs(TEACHER_DIR, "ensemble", None, ReplayConfig(L=3, R=7))


@needs_teacher
def test_table17_refit_rss_eoq_g(teacher_inputs):
    res = replay(teacher_inputs, ReplayConfig(L=3, R=7), "REFIT-RSS-EOQ-G")
    assert res["cost"] == pytest.approx(719971.22, abs=1.0)
    assert res["holding"] == pytest.approx(467614.34, abs=1.0)
    assert res["lost"] == pytest.approx(67794.88, abs=0.1)
    assert res["ordering"] == 184562
    assert res["orders"] == 92281
    assert res["fill"] == pytest.approx(0.985062, abs=1e-5)
    assert res["min_class_csl"] == pytest.approx(0.9598, abs=1e-4)
    assert res["n_cycles"] == 51
    teacher = load_teacher_selection(TEACHER_DIR, "ensemble", 3, 7, "e10b")
    expected = next(e for e in teacher if e["policy"] == "REFIT-RSS-EOQ-G")
    assert res["selection"] == expected


@needs_teacher
def test_e9c_refit_rss_g_and_one_sided_c3(teacher_inputs):
    cfg = ReplayConfig(L=3, R=7)
    g = replay(teacher_inputs, cfg, "REFIT-RSS-G")
    assert g["cost"] == pytest.approx(750509.84, abs=1.0)
    c3 = replay(teacher_inputs, cfg, "REFIT-RSS-C3", candidate_stats=g["_candidates"])
    assert c3["cost"] == pytest.approx(750737.16, abs=1.0)
    assert c3["selection"]["schedule"] == g["selection"]["schedule"]
