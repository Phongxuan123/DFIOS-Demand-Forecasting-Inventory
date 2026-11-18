"""P3 model-switch option of scripts/load_teacher_data.py (SQLite, tiny fake teacher folder)."""
import json
import os
import sys
from datetime import date

import numpy as np
import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(BE_DIR, "scripts"))

import load_teacher_data as ltd  # noqa: E402
import app.models  # noqa: E402,F401
from app.models.base import Base  # noqa: E402
from app.models.forecast_window_quantile import ForecastWindowQuantile  # noqa: E402
from app.services import policy_config as pc  # noqa: E402
from app.services.window_quantile_service import DEFAULT_MODEL_RUN_ID  # noqa: E402

T = 1941
ITEMS = ["FOODS_1_001", "FOODS_1_002", "HOBBIES_1_001"]
REVIEWS = np.arange(1395, T, 7)
SWITCH = 1759


def _q(origins, n, base):
    """Q[o, i, l] = base + 100*i + o/1000 + l/100, so model and origin are recoverable from a value."""
    lv = np.arange(len(ltd.QUANTILE_LEVELS))
    return (base + 100.0 * np.arange(n)[None, :, None] + origins[:, None, None] / 1000.0
            + lv[None, None, :] / 100.0).astype(np.float32)


@pytest.fixture()
def teacher_dir(tmp_path):
    rng = np.random.default_rng(5)
    prep = tmp_path / "c3out_experiments" / "data" / "m5_prepared"
    prep.mkdir(parents=True)
    n = 4  # 3 CA_1 rows then 1 TX_1 row
    y = rng.poisson(1.5, size=(n, T)).astype(np.float32)
    price = np.full((n, T), 2.5, dtype=np.float32)
    np.save(prep / "y.npy", y)
    np.save(prep / "price.npy", price)
    items = ITEMS + ["FOODS_1_001"]
    pd.DataFrame({
        "id": [f"{i}_{s}" for i, s in zip(items, ["CA_1"] * 3 + ["TX_1"])], "item_id": items,
        "dept_id": [i.rsplit("_", 1)[0] for i in items], "cat_id": [i.split("_")[0] for i in items],
        "store_id": ["CA_1"] * 3 + ["TX_1"], "abcxyz_merged": ["AX", "BY", "CZ", "AX"],
        "mean_price": price.mean(axis=1),
    }).to_parquet(prep / "meta.parquet")
    (prep / "info.json").write_text(json.dumps({"VAL_START": 1395, "TEST_START": 1577, "T_END": T}))
    # model A only in the bundle (78 weekly origins), model B full-size in DFIOS/results/forecasts
    a_dir = tmp_path / "c3out_bundle" / "results" / "m5" / "forecasts" / "chronos_bolt"
    b_dir = tmp_path / "DFIOS" / "results" / "forecasts" / "ensemble"
    for d, origins, base in ((a_dir, REVIEWS, 1000.0), (b_dir, np.arange(1395, T), 5000.0)):
        d.mkdir(parents=True)
        np.save(d / "origins.npy", origins)
        np.save(d / "Q_H10.npy", _q(origins, n, base))
    # an incomplete copy of model A that must be skipped (origins stop before T)
    bad = tmp_path / "c3out_experiments" / "results" / "m5" / "forecasts" / "chronos_bolt"
    bad.mkdir(parents=True)
    np.save(bad / "origins.npy", REVIEWS[:10])
    np.save(bad / "Q_H10.npy", _q(REVIEWS[:10], n, -1.0))
    return str(tmp_path)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine, autoflush=False)()
    yield s
    s.close()


def _q95(db, item, day):
    r = db.query(ForecastWindowQuantile).filter_by(item_id=item, origin_date=ltd.day_to_date(day)).one()
    return r


def test_resolve_forecast_dir_skips_incomplete_and_uses_bundle(teacher_dir):
    d = ltd.resolve_forecast_dir(teacher_dir, "chronos_bolt", REVIEWS, 10)
    assert d.replace("\\", "/").endswith("c3out_bundle/results/m5/forecasts/chronos_bolt")
    d = ltd.resolve_forecast_dir(teacher_dir, "ensemble", REVIEWS, 10)
    assert d.replace("\\", "/").endswith("DFIOS/results/forecasts/ensemble")
    with pytest.raises(FileNotFoundError):
        ltd.resolve_forecast_dir(teacher_dir, "sba", REVIEWS, 10)
    with pytest.raises(FileNotFoundError):  # bundle has no daily origins
        ltd.resolve_forecast_dir(teacher_dir, "chronos_bolt", np.arange(1395, 1400), 10)


def test_read_teacher_switch_splits_at_switch_day(teacher_dir):
    td = ltd.read_teacher(teacher_dir, "CA_1", switch_from="chronos_bolt", switch_to="ensemble",
                          switch_day=SWITCH)
    q = td["q"]
    assert q.shape == (78, 3, 19)
    before, after = REVIEWS < SWITCH, REVIEWS >= SWITCH
    assert (q[before] < 2000).all() and (q[after] > 4000).all()
    k = int(np.flatnonzero(REVIEWS == SWITCH)[0])
    assert q[k, 1, 10] == pytest.approx(5000 + 100 + SWITCH / 1000 + 0.10, abs=1e-2)
    assert q[k - 1, 1, 10] == pytest.approx(1000 + 100 + (SWITCH - 7) / 1000 + 0.10, abs=1e-2)
    sw = td["switch"]
    assert sw["day"] == SWITCH and sw["date"] == "2015-11-23" and sw["first_review_after"] == SWITCH
    assert sw["reviews_from"] == 52 and sw["reviews_to"] == 26
    assert td["model"] == "chronos_bolt->ensemble"


def test_switch_day_defaults_to_test_plus_182_and_validates(teacher_dir):
    td = ltd.read_teacher(teacher_dir, "CA_1", switch_from="chronos_bolt", switch_to="ensemble")
    assert td["switch"]["day"] == 1577 + 182 == SWITCH
    with pytest.raises(ValueError):
        ltd.read_teacher(teacher_dir, "CA_1", switch_from="chronos_bolt")
    with pytest.raises(ValueError):
        ltd.read_teacher(teacher_dir, "CA_1", switch_day=SWITCH)
    with pytest.raises(ValueError):
        ltd.read_teacher(teacher_dir, "CA_1", switch_from="chronos_bolt", switch_to="ensemble", switch_day=T)


def test_no_switch_is_unchanged(teacher_dir):
    td = ltd.read_teacher(teacher_dir, "CA_1", model="chronos_bolt")
    assert td["switch"] is None and (td["q"] < 2000).all()


def test_load_quantiles_switch_rows_same_run_and_route(teacher_dir, db):
    rep = ltd.run(db, teacher_dir, "CA_1", steps=("quantiles",), log=lambda *_: None,
                  switch_from="chronos_bolt", switch_to="ensemble", switch_day=SWITCH)
    rows = db.query(ForecastWindowQuantile).all()
    assert len(rows) == 78 * 3
    assert {r.model_run_id for r in rows} == {DEFAULT_MODEL_RUN_ID}
    assert {r.route for r in rows} == {pc.ROUTE_TEACHER}
    assert rep["quantiles"]["switch"]["to"] == "ensemble"
    for r in rows:
        day = (r.origin_date - ltd.DAY0).days
        assert (r.q_levels["0.95"] > 4000) == (day >= SWITCH)
    assert _q95(db, "FOODS_1_002", SWITCH).q_levels["0.95"] == pytest.approx(5100 + SWITCH / 1000 + 0.1, abs=1e-3)
    assert _q95(db, "FOODS_1_002", SWITCH - 7).q_levels["0.95"] < 2000
    assert _q95(db, "FOODS_1_001", 1577).origin_date == date(2015, 5, 25)
    # re-running without the switch replaces every row (no stale model-B rows remain)
    ltd.run(db, teacher_dir, "CA_1", model="chronos_bolt", steps=("quantiles",), log=lambda *_: None)
    rows = db.query(ForecastWindowQuantile).all()
    assert len(rows) == 78 * 3 and all(r.q_levels["0.95"] < 2000 for r in rows)


@pytest.mark.parametrize("url,ok", [
    ("postgresql+psycopg2://u:p@localhost:5432/dfios_sandbox_f3", True),
    ("postgresql://u:p@127.0.0.1/dfios_sandbox_f2", True),
    ("postgresql+psycopg2://u:p@localhost:5432/dfios_sandbox", True),
    ("postgresql+psycopg2://u:p@localhost:5432/dfios_supabase_copy", False),
    ("postgresql+psycopg2://u:p@localhost:5432/x_dfios_sandbox", False),
    ("postgresql+psycopg2://u:p@db.example.supabase.co:5432/dfios_sandbox_f3", False),
])
def test_guard_accepts_dfios_sandbox_prefix(url, ok):
    if ok:
        assert ltd.assert_sandbox_url(url) == url
    else:
        with pytest.raises(RuntimeError):
            ltd.assert_sandbox_url(url)
