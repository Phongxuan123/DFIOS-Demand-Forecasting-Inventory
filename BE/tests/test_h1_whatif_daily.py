"""H1: what-if with daily reviews (R = 1) from daily-origin teacher window quantiles (H = L + R), R = 7 unchanged;
the --daily-origins loader step on SQLite with a tiny fake teacher folder."""
import json
import os
import sys

import numpy as np
import pandas as pd
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(BE_DIR, "scripts"))

import load_teacher_data as ltd  # noqa: E402
import app.models  # noqa: E402,F401
from app.models.base import Base  # noqa: E402
from app.models.classification import SKUClassification  # noqa: E402
from app.models.forecast_window_quantile import ForecastWindowQuantile as FWQ  # noqa: E402
from app.models.product import Product  # noqa: E402
from app.models.sales_history import SalesHistory  # noqa: E402
from app.models.sim_clock import SimClock  # noqa: E402
from app.schemas.simulation import WhatIfRequest  # noqa: E402
from app.services import e10b_replay as rp  # noqa: E402
from app.services import policy_backtest  # noqa: E402
from app.services import policy_config as pc  # noqa: E402
from app.services.what_if_service import what_if_service  # noqa: E402

STORE = "CA_1"
O_IDX = 1700
ITEMS = ["FOODS_1_001", "FOODS_1_002", "HOBBIES_1_001", "HOBBIES_1_002"]
SEG = {"FOODS_1_001": "AX", "FOODS_1_002": "AX", "HOBBIES_1_001": "BY", "HOBBIES_1_002": "BY"}
LAM = np.array([3.0, 1.5, 0.7, 2.0])
FIRST = O_IDX - 200


def _q(n: int, d: int, H: int) -> float:
    return round(LAM[n] * H * 1.4 + 0.3 * ((d + n) % 5), 4)


def _session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()


def _row(it, n, d, H):
    od = pc.day_index_to_date(d)
    v = _q(n, d, H)
    return FWQ(id=f"t_{it}_{d}_{H}", model_run_id="backtest-ensemble-v1", store_id=STORE, item_id=it, origin_date=od,
               horizon_days=H, point_window=v * 0.6, q_levels={"0.5": v * 0.6, "0.95": v}, route=pc.ROUTE_TEACHER)


@pytest.fixture()
def panel():
    s = _session()
    rng = np.random.default_rng(11)
    y = rng.poisson(LAM[:, None], size=(len(ITEMS), O_IDX - FIRST)).astype(float)
    s.add(SimClock(store_id=STORE, current_date=pc.day_index_to_date(O_IDX), start_date=pc.day_index_to_date(O_IDX)))
    for n, it in enumerate(ITEMS):
        seg = SEG[it]
        s.add(Product(item_id=it, name=it, cat_id=it.split("_")[0], price=2.0 + n))
        s.add(SKUClassification(id=f"c_{it}", item_id=it, store_id=STORE, abc_class=seg[0], xyz_class=seg[1],
                                segment=seg, class_source="teacher_meta"))
        for j in range(O_IDX - FIRST):
            d = FIRST + j
            s.add(SalesHistory(id=f"s_{it}_{d}", item_id=it, store_id=STORE, sale_date=pc.day_index_to_date(d),
                               quantity=float(y[n, j])))
        for d in range(O_IDX - 84, O_IDX):              # daily origins, H = 4 (R = 1, L = 3)
            s.add(_row(it, n, d, 4))
        for d in range(O_IDX - 84, O_IDX, 7):           # weekly origins, H = 10 (R = 7, L = 3)
            s.add(_row(it, n, d, 10))
    s.commit()
    return s, y


POL = [{"policy_key": "p", "m_g": 0.2, "kappa_g": 1.0}]


def test_r1_runs_on_daily_teacher_rows_and_equals_the_engine(panel):
    s, y = panel
    res = what_if_service.run(s, WhatIfRequest(store_id=STORE, review_period_days=1, lead_time_days=3, n_reviews=8,
                                               tau=0.95, policies=POL))
    assert res.review_period_days == 1 and res.horizon_days == 4
    assert res.r_options == [1, 7]
    assert res.n_reviews == 56                                     # same 8-week span, a review every day
    assert res.period_start == pc.day_index_to_date(O_IDX - 56).isoformat()
    assert res.period_end == pc.day_index_to_date(O_IDX - 1).isoformat()
    assert "imported teacher window quantiles" in res.quantile_basis and "route (c)" not in res.quantile_basis
    reviews = list(range(O_IDX - 56, O_IDX))
    for c in ("AX", "BY"):
        data, skip = what_if_service._class_inputs(s, STORE, c, O_IDX, 8, 0.95, 3, 1, 0.002, 2.0, reviews=reviews)
        assert skip is None
        idx = [ITEMS.index(i) for i in sorted(i for i in ITEMS if SEG[i] == c)]
        np.testing.assert_allclose(data["q"], [[_q(n, d, 4) for d in reviews] for n in idx])
        np.testing.assert_array_equal(data["dem"], y[idx][:, O_IDX - 56 - FIRST:])
        # EOQ = sqrt(2 c mu56 / (h p)) at each review
        mu = np.stack([y[idx][:, d - 56 - FIRST:d - FIRST].mean(axis=1) for d in reviews], axis=1)
        p = np.array([2.0 + n for n in idx])[:, None]
        np.testing.assert_allclose(data["eoq"], np.sqrt(2 * 2.0 * mu / (0.002 * p)))
        eng = policy_backtest.simulate_rss_candidates(
            data["dem"], data["q"], data["eoq"], data["price"], [0.2], [1.0], lead_time=3, review_period=1,
            initial_on_hand=data["init"], daily_price=data["daily_price"])
        got = next(x for x in res.policies[0].by_class if x.class_id == c)
        assert got.total_cost == pytest.approx(round(float(eng.cost[0]), 2))
        assert got.orders == int(eng.orders[0])
        assert got.availability == pytest.approx(round(float(eng.availability[0]), 5))


@pytest.mark.parametrize("R", [1, 7])
def test_what_if_equals_the_offline_replay_simulator(panel, R):
    """The same arrays through e10b_replay.simulate / segment_summary (teacher E10b rules) give the same cost."""
    s, y = panel
    res = what_if_service.run(s, WhatIfRequest(store_id=STORE, review_period_days=R, lead_time_days=3, n_reviews=8,
                                               tau=0.95, policies=POL))
    start, end = O_IDX - 56, O_IDX
    rd = np.arange(start, end, R)
    full_y = np.zeros((len(ITEMS), end))
    full_y[:, FIRST:] = y
    price = np.repeat(np.array([2.0 + n for n in range(len(ITEMS))])[:, None], end, axis=1)
    names, groups = np.unique([SEG[i] for i in ITEMS], return_inverse=True)
    q = np.array([[_q(n, d, 3 + R) for n in range(len(ITEMS))] for d in rd])
    inputs = rp.ReplayInputs(y=full_y, price=price, groups=groups, class_names=list(names), q=q, review_days=rd,
                             L=3, R=R)
    cfg = rp.ReplayConfig(L=3, R=R, VAL_START=start, TEST_START=start, T=end)
    K, G = len(rd), len(names)
    tr = rp.simulate(inputs, cfg, np.full((K, G), 0.2), np.full((K, G), 1.0), rp.eoq_base(full_y, price, rd, cfg))
    seg = rp.segment_summary(tr, inputs, cfg, start, end)
    ov = res.policies[0].overall
    assert ov.total_cost == pytest.approx(seg["cost"], abs=0.02)
    assert ov.orders == seg["orders"]
    assert ov.fill_rate == pytest.approx(seg["fill"], abs=1e-5)
    for c in res.policies[0].by_class:
        assert c.availability == pytest.approx(seg["class_csl"][c.class_id], abs=1e-5)


def test_missing_daily_rows_give_422_with_r_options_7(panel):
    s, _ = panel
    s.query(FWQ).filter(FWQ.horizon_days == 4, FWQ.origin_date == pc.day_index_to_date(O_IDX - 3)).delete()
    s.commit()
    with pytest.raises(HTTPException) as ei:
        what_if_service.run(s, WhatIfRequest(store_id=STORE, review_period_days=1, n_reviews=8, policies=POL))
    d = ei.value.detail
    assert ei.value.status_code == 422 and d["reason_code"] == "unsupported_review_period"
    assert d["r_options"] == [7] and "R = 1" in d["reason"] and "--daily-origins" in d["reason"]
    ok = what_if_service.run(s, WhatIfRequest(store_id=STORE, review_period_days=7, n_reviews=8, policies=POL))
    assert ok.r_options == [7] and ok.n_reviews == 8


def test_r_options_follow_the_lead_time(panel):
    s, _ = panel
    # L = 1 -> H = 2 (R = 1) and H = 8 (R = 7): no such rows and no forecast_backtest -> nothing replayable
    with pytest.raises(HTTPException) as ei:
        what_if_service.run(s, WhatIfRequest(store_id=STORE, lead_time_days=1, review_period_days=1, policies=POL))
    assert ei.value.detail["reason_code"] == "no_review_forecasts"
    assert what_if_service.r_options(s, STORE, L=3, n_reviews=8) == [1, 7]


# ------------------------------------------------------------------ loader --daily-origins
T = 1941


@pytest.fixture()
def teacher_dir(tmp_path):
    rng = np.random.default_rng(5)
    prep = tmp_path / "c3out_experiments" / "data" / "m5_prepared"
    fdir = tmp_path / "DFIOS" / "results" / "forecasts" / "ensemble"
    prep.mkdir(parents=True)
    fdir.mkdir(parents=True)
    n = 3   # 2 CA_1 rows then 1 TX_1 row
    y = rng.poisson(1.0, size=(n, T)).astype(np.float32)
    price = np.full((n, T), 3.0, dtype=np.float32)
    np.save(prep / "y.npy", y)
    np.save(prep / "price.npy", price)
    meta = pd.DataFrame({"id": ["A_CA_1", "B_CA_1", "A_TX_1"], "item_id": ["FOODS_1_001", "FOODS_1_002", "FOODS_1_001"],
                         "dept_id": ["FOODS_1"] * 3, "cat_id": ["FOODS"] * 3, "store_id": ["CA_1", "CA_1", "TX_1"],
                         "abcxyz_merged": ["AX", "BY", "AX"], "mean_price": [3.0, 3.0, 3.0]})
    meta.to_parquet(prep / "meta.parquet")
    (prep / "info.json").write_text(json.dumps({"VAL_START": 1395, "TEST_START": 1577, "T_END": T}))
    origins = np.arange(1395, T)
    lv = np.array(ltd.QUANTILE_LEVELS)
    np.save(fdir / "origins.npy", origins)
    for H in (4, 10):
        q = (H * (0.5 + lv[None, None, :]) * np.ones((len(origins), n, 1))
             + (origins - 1395)[:, None, None] * 0.001 + np.arange(n)[None, :, None]).astype(np.float32)
        np.save(fdir / f"Q_H{H}.npy", q)
    return str(tmp_path)


def test_loader_daily_origins_keeps_weekly_rows_and_is_idempotent(teacher_dir):
    s = _session()
    log = []
    ltd.run(s, teacher_dir, "CA_1", steps=["quantiles"], log=log.append)          # weekly H = 10 (78 origins)
    weekly = {r.id: r.q_levels for r in s.query(FWQ).filter(FWQ.horizon_days == 10)}
    assert len(weekly) == 78 * 2
    rep = ltd.run(s, teacher_dir, "CA_1", steps=["quantiles"], log=log.append, daily_horizons=[4, 10])["quantiles"]
    n_days = T - 1395
    assert rep["H4"]["origins"] == n_days and rep["H4"]["rows_inserted"] == n_days * 2
    assert rep["H10"]["origins_kept_existing"] == 78 and rep["H10"]["rows_inserted"] == (n_days - 78) * 2
    for H in (4, 10):
        assert s.query(FWQ).filter(FWQ.horizon_days == H).count() == n_days * 2
        assert {r[0] for r in s.query(FWQ.route).filter(FWQ.horizon_days == H)} == {pc.ROUTE_TEACHER}
    assert {r.id: r.q_levels for r in s.query(FWQ).filter(FWQ.id.in_(list(weekly)))} == weekly   # untouched
    row = s.query(FWQ).filter(FWQ.horizon_days == 4, FWQ.item_id == "FOODS_1_002",
                              FWQ.origin_date == pc.day_index_to_date(1400)).one()
    assert row.q_levels["0.95"] == pytest.approx(round(4 * 1.45 + 5 * 0.001 + 1, 4), abs=1e-4)
    assert row.model_run_id == "backtest-ensemble-v1"
    again = ltd.run(s, teacher_dir, "CA_1", steps=["quantiles"], log=log.append, daily_horizons=[4, 10])["quantiles"]
    assert again["H4"]["rows_inserted"] == 0 and again["H10"]["rows_inserted"] == 0
    assert s.query(FWQ).count() == n_days * 2 * 2
