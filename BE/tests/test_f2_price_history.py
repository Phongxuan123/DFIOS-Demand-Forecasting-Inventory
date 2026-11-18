# ruff: noqa: F811  (pytest fixtures imported from test_p2_teacher_loader)
"""G-37 daily price (price_history) on SQLite: daily price used when present, products.price fallback otherwise,
EOQ / holding / lost valued at the price of the day; the teacher price loader and the continuous clock start."""
import math
import os
import sys
from datetime import date, timedelta

import numpy as np
import pytest

BE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(BE_DIR, "scripts"))

import load_teacher_data as ltd  # noqa: E402
import load_teacher_prices as ltp  # noqa: E402
from app.models.inventory_param import InventoryParam  # noqa: E402
from app.models.policy_selection import PolicySelection  # noqa: E402
from app.models.price_history import PriceHistory  # noqa: E402
from app.models.sim_clock import SimClock  # noqa: E402
from app.repositories import price_history_repository as phr  # noqa: E402
from app.services import policy_config as pc  # noqa: E402
from app.services.optimization_service import optimization_service  # noqa: E402

from tests.test_p2_teacher_loader import CA_ITEMS, db, teacher_dir  # noqa: E402,F401  (fixtures)

D0 = date(2016, 4, 25)


# --------------------------------------------------------------------------- repository
def test_repository_fallback_when_table_empty(db):
    assert not phr.has_prices(db, "CA_1")
    M = phr.price_matrix(db, "CA_1", ["FOODS_1_001", "HOBBIES_1_001", "NOPE"], D0, D0 + timedelta(days=3))
    np.testing.assert_array_equal(M[:2], [[3.5] * 3, [2.0] * 3])
    assert np.isnan(M[2]).all()
    # products.price 0 is not a price
    assert np.isnan(phr.price_on(db, "CA_1", ["FOODS_1_002"], D0)[0])


def test_repository_daily_price_per_cell_with_fallback(db):
    db.add_all([
        PriceHistory(store_id="CA_1", item_id="FOODS_1_001", date=D0 + timedelta(days=1), price=4.25),
        PriceHistory(store_id="CA_1", item_id="FOODS_1_002", date=D0, price=1.5),
        PriceHistory(store_id="TX_1", item_id="HOBBIES_1_001", date=D0, price=99.0),   # other store
        PriceHistory(store_id="CA_1", item_id="HOBBIES_1_001", date=D0, price=0.0),    # not a price
    ])
    db.commit()
    M = phr.price_matrix(db, "CA_1", ["FOODS_1_001", "FOODS_1_002", "HOBBIES_1_001"], D0, D0 + timedelta(days=2))
    np.testing.assert_array_equal(M[0], [3.5, 4.25])
    assert M[1, 0] == 1.5 and np.isnan(M[1, 1])
    np.testing.assert_array_equal(M[2], [2.0, 2.0])
    assert phr.price_map_on(db, "CA_1", ["FOODS_1_001", "FOODS_1_002"], D0 + timedelta(days=1)) == {
        "FOODS_1_001": 4.25}


# --------------------------------------------------------------------------- hand-computed tiny panel
def test_holding_and_lost_valued_at_the_price_of_the_day():
    """1 SKU, L = 1, R = 2, demand 3, 0, 5, 1, Q_hat 4, kappa 0, initial stock round(2 * 3) = 6:
    day 0 review IP 6 >= 4 no order, end 3 | day 1 end 3 | day 2 review IP 3 < 4 -> order 1 (arrives day 3),
    demand 5: 3 sold, 2 lost, end 0 | day 3 +1, demand 1, end 0.
    Holding 0.002 * (3 p0 + 3 p1), lost 0.35 * 2 p2, ordering 2."""
    dem = np.array([[3.0, 0.0, 5.0, 1.0]])
    q = np.array([[4.0, 4.0]])
    eoq = np.zeros((1, 2))
    p_day = np.array([[1.0, 2.0, 3.0, 4.0]])
    hist = np.array([[2.0]])
    kw = dict(lead_time=1, review_period=2)
    daily = optimization_service.score_window(dem, q, eoq, np.array([1.0]), hist, [0.0], [0.0], 0,
                                              daily_price=p_day, **kw)
    const = optimization_service.score_window(dem, q, eoq, np.array([1.0]), hist, [0.0], [0.0], 0, **kw)
    full = daily["full"]
    assert full.holding[0] == pytest.approx(0.002 * (3 * 1 + 3 * 2))
    assert full.shortage[0] == pytest.approx(0.35 * 2 * 3)
    assert full.ordering[0] == 2.0
    assert daily["cost"][0] == pytest.approx(0.018 + 2.1 + 2.0)
    assert const["cost"][0] == pytest.approx(0.002 * 6 + 0.35 * 2 + 2.0)
    # a window that starts at review 1 only carries the costs of days 2..3 (prefix runs sliced with the prices)
    w1 = optimization_service.score_window(dem, q, eoq, np.array([1.0]), hist, [0.0], [0.0], 1,
                                           daily_price=p_day, **kw)
    assert w1["cost"][0] == pytest.approx(0.35 * 2 * 3 + 2.0)


def test_teacher_eoq_at_review_day_price():
    mu = np.array([[2.0, 2.0]])
    p = np.array([[1.0, 4.0]])
    np.testing.assert_allclose(optimization_service.teacher_eoq(mu, p),
                               [[math.sqrt(2 * 2 * 2 / (0.002 * 1)), math.sqrt(2 * 2 * 2 / (0.002 * 4))]])


# --------------------------------------------------------------------------- engine wiring
def _load(db, tdir, steps=("classes", "sales", "quantiles")):
    ltd.run(db, tdir, "CA_1", steps=steps, log=lambda *_: None)


def test_parameters_use_review_day_price_else_constant(teacher_dir, db):
    tdir, y, price, q = teacher_dir
    _load(db, tdir)
    optimization_service.recompute_parameters(db, store_id="CA_1")
    before = {p.item_id: p for p in db.query(InventoryParam).filter_by(store_id="CA_1")}
    assert before["FOODS_1_001"].unit_price == 3.5          # no daily row: products.price
    eoq_before = before["FOODS_1_001"].eoq
    db.add(PriceHistory(store_id="CA_1", item_id="FOODS_1_001", date=D0, price=7.0))
    db.add(PriceHistory(store_id="CA_1", item_id="FOODS_1_001", date=D0 - timedelta(days=1), price=50.0))
    db.commit()
    optimization_service.recompute_parameters(db, store_id="CA_1")
    after = {p.item_id: p for p in db.query(InventoryParam).filter_by(store_id="CA_1")}
    assert after["FOODS_1_001"].unit_price == 7.0           # price of the review (clock) day
    assert after["HOBBIES_1_001"].unit_price == 2.0         # fallback for the item without rows
    assert after["FOODS_1_001"].eoq == pytest.approx(eoq_before * math.sqrt(3.5 / 7.0))
    mu = float(y[0, pc.date_to_day_index(D0) - 56:pc.date_to_day_index(D0)].mean())
    assert after["FOODS_1_001"].eoq == pytest.approx(math.sqrt(2 * 2 * mu / (0.002 * 7.0)))


def test_j5_values_candidates_at_daily_price(teacher_dir, db, monkeypatch):
    tdir, y, price, q = teacher_dir
    _load(db, tdir)
    o_idx = 1577
    base = optimization_service.evaluate_class_candidates(db, "CA_1", "AX", o_idx)[0]
    # rows equal to products.price everywhere: identical to the empty table (no-op)
    s0 = pc.day_index_to_date(1395)
    db.add_all([PriceHistory(store_id="CA_1", item_id="FOODS_1_001", date=s0 + timedelta(days=j), price=3.5)
                for j in range(o_idx - 1395)])
    db.commit()
    same = optimization_service.evaluate_class_candidates(db, "CA_1", "AX", o_idx)[0]
    np.testing.assert_allclose(same["cost"], base["cost"])
    # teacher daily price: EOQ at the review-day price, holding / lost at the price of each day
    db.query(PriceHistory).delete()
    ltp.load_prices(db, "CA_1", CA_ITEMS, np.asarray(price[:4, 1031:], dtype=np.float64), 1031)
    seen = {}
    orig = optimization_service.teacher_eoq

    def spy(mu, p):
        seen["p"] = np.asarray(p, dtype=float)
        return orig(mu, p)

    monkeypatch.setattr(optimization_service, "teacher_eoq", spy)
    daily = optimization_service.evaluate_class_candidates(db, "CA_1", "AX", o_idx)[0]
    reviews = list(range(1395, o_idx - 6, 7))
    np.testing.assert_allclose(seen["p"], np.asarray(price[[0], :], dtype=np.float64)[:, reviews])
    assert not np.allclose(daily["cost"], base["cost"])


# --------------------------------------------------------------------------- loader + continuous clock
@pytest.mark.parametrize("url", ["sqlite://", "postgresql+psycopg2://u:p@localhost:5432/dfios_sandbox",
                                 "postgresql://u:p@127.0.0.1/dfios_sandbox_f2"])
def test_price_guard_accepts_sandbox_prefix(url):
    assert ltp.assert_sandbox_prefix_url(url) == url


@pytest.mark.parametrize("url", ["", None, "postgresql://u:p@localhost/dfios_supabase_copy",
                                 "postgresql://u:p@localhost/dfios", "postgresql://u:p@localhost/dfios_b",
                                 "postgresql://u:p@db.x.supabase.co/dfios_sandbox_f2", "mysql://u:p@localhost/x"])
def test_price_guard_refuses_everything_else(url):
    with pytest.raises(RuntimeError):
        ltp.assert_sandbox_prefix_url(url)


def test_load_teacher_prices_idempotent(teacher_dir, db):
    tdir, y, price, q = teacher_dir
    items, p, s0, T = ltp.read_prices(tdir, "CA_1", 1931)
    assert items == CA_ITEMS and p.shape == (4, 10) and s0 == 1931
    rep = ltp.load_prices(db, "CA_1", items, p, s0)
    assert rep["rows"] == 40 and rep["first_date"] == pc.day_index_to_date(1931).isoformat()
    rep2 = ltp.load_prices(db, "CA_1", items, p, s0)
    assert rep2["deleted_before"] == 40 and db.query(PriceHistory).count() == 40
    row = db.get(PriceHistory, ("CA_1", "HOBBIES_1_001", pc.day_index_to_date(1935)))
    assert row.price == float(price[2, 1935])


def test_clock_step_continuous_start(teacher_dir, db):
    tdir, y, price, q = teacher_dir
    _load(db, tdir)
    rep = ltd.run(db, tdir, "CA_1", steps=("clock",), log=lambda *_: None, clock_start_day=1395,
                  refit_as_of_day=1577)
    clock = db.get(SimClock, "CA_1")
    assert clock.start_date == clock.current_date == date(2014, 11, 24)
    assert rep["clock"]["initial_refit_as_of"] == "2015-05-25"
    sel0 = {s.class_id: (s.m_g, s.kappa_g) for s in db.query(PolicySelection).filter_by(selection_id="CA_1_refit_0")}
    # same selection #0 as the cold start at 1577 (window = the 26 weeks before TEST_START)
    ltd.run(db, tdir, "CA_1", steps=("clock",), log=lambda *_: None)
    cold = {s.class_id: (s.m_g, s.kappa_g) for s in db.query(PolicySelection).filter_by(selection_id="CA_1_refit_0")}
    assert sel0 == cold and len(sel0) == 9
