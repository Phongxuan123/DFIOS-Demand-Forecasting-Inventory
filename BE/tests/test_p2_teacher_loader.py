"""P2 sandbox loader (scripts/load_teacher_data.py) on SQLite with a tiny fake teacher folder."""
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
from app.models.calibration_state import CalibrationState  # noqa: E402
from app.models.classification import SKUClassification  # noqa: E402
from app.models.forecast_window_quantile import ForecastWindowQuantile  # noqa: E402
from app.models.inventory import Inventory  # noqa: E402
from app.models.product import Product  # noqa: E402
from app.models.sales_history import SalesHistory  # noqa: E402
from app.models.sim_clock import SimClock  # noqa: E402
from app.services import policy_config as pc  # noqa: E402
from app.services.window_quantile_service import window_quantile_service  # noqa: E402

T = 1941
CA_ITEMS = ["FOODS_1_001", "FOODS_1_002", "HOBBIES_1_001", "HOUSEHOLD_1_001"]
CA_CLASSES = ["AX", "AY", "CZ", "CX"]


@pytest.fixture()
def teacher_dir(tmp_path):
    rng = np.random.default_rng(3)
    prep = tmp_path / "c3out_experiments" / "data" / "m5_prepared"
    fdir = tmp_path / "DFIOS" / "results" / "forecasts" / "ensemble"
    prep.mkdir(parents=True)
    fdir.mkdir(parents=True)
    n = 6  # 4 CA_1 rows then 2 TX_1 rows
    lam = np.array([2.0, 0.5, 0.2, 5.0, 1.0, 1.0])
    y = rng.poisson(lam[:, None], size=(n, T)).astype(np.float32)
    price = np.round(rng.uniform(1, 9, size=(n, 1)) + rng.uniform(0, 0.2, size=(n, T)), 2).astype(np.float32)
    np.save(prep / "y.npy", y)
    np.save(prep / "price.npy", price)
    items = CA_ITEMS + ["FOODS_1_001", "FOODS_1_002"]
    meta = pd.DataFrame({
        "id": [f"{i}_{s}" for i, s in zip(items, ["CA_1"] * 4 + ["TX_1"] * 2)],
        "item_id": items, "dept_id": [i.rsplit("_", 1)[0] for i in items],
        "cat_id": [i.split("_")[0] for i in items], "store_id": ["CA_1"] * 4 + ["TX_1"] * 2,
        "abcxyz_merged": CA_CLASSES + ["AX", "AY"], "mean_price": price.mean(axis=1).astype(np.float32),
    })
    meta.to_parquet(prep / "meta.parquet")
    (prep / "info.json").write_text(json.dumps({"VAL_START": 1395, "TEST_START": 1577, "T_END": T}))
    origins = np.arange(1395, T)
    lv = np.array(ltd.QUANTILE_LEVELS)
    q = (lam[None, :, None] * 10 * (0.5 + lv[None, None, :])
         + (origins - 1395)[:, None, None] * 0.001).astype(np.float32)
    np.save(fdir / "origins.npy", origins)
    np.save(fdir / "Q_H10.npy", q)
    return str(tmp_path), y, price, q


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine, autoflush=False)()
    # existing app state: one product the teacher dropped (with a classification), one priced product, one with 0
    s.add_all([
        Product(item_id="FOODS_1_001", name="a", price=3.5),
        Product(item_id="FOODS_1_002", name="b", price=0.0),
        Product(item_id="HOBBIES_1_001", name="c", price=2.0),
        Product(item_id="HOUSEHOLD_1_001", name="d", price=4.0),
        Product(item_id="DROPPED_1_001", name="x", price=1.0),
        SKUClassification(id="CA_1_DROPPED_1_001", item_id="DROPPED_1_001", store_id="CA_1", abc_class="A",
                          xyz_class="X", segment="AX", class_source="thresholds"),
        SKUClassification(id="CA_1_FOODS_1_001", item_id="FOODS_1_001", store_id="CA_1", abc_class="C",
                          xyz_class="Z", segment="CZ", class_source="thresholds"),
        SimClock(store_id="CA_1", current_date=date(2016, 4, 25), start_date=date(2016, 4, 25)),
    ])
    s.add_all([Inventory(item_id=i, store_id="CA_1", on_hand=0.0, on_order=0.0)
               for i in CA_ITEMS + ["DROPPED_1_001"]])
    s.commit()
    yield s
    s.close()


@pytest.mark.parametrize("url", [
    "sqlite:///x.db",
    "postgresql+psycopg2://u:p@localhost:5432/dfios_sandbox",
    "postgresql://u:p@127.0.0.1/dfios_sandbox",
])
def test_guard_accepts_only_local_sandbox(url):
    assert ltd.assert_sandbox_url(url) == url


@pytest.mark.parametrize("url", [
    "", None,
    "postgresql+psycopg2://u:p@localhost:5432/dfios_supabase_copy",
    "postgresql+psycopg2://u:p@localhost:5432/dfios",
    "postgresql+psycopg2://u:p@db.example.supabase.co:5432/dfios_sandbox",
    "postgresql+psycopg2://u:p@10.0.0.5:5432/dfios_sandbox",
    "mysql://u:p@localhost/dfios_sandbox",
])
def test_guard_refuses_everything_else(url):
    with pytest.raises(RuntimeError):
        ltd.assert_sandbox_url(url)


def test_load_all_steps_and_idempotent(teacher_dir, db):
    tdir, y, price, q = teacher_dir
    rep = ltd.run(db, tdir, "CA_1", steps=("classes", "sales", "prices", "quantiles"), log=lambda *_: None)
    assert rep["n_skus"] == 4
    # (a) classes = teacher labels, source teacher_meta, the dropped SKU leaves the store's classes
    cls = {c.item_id: c for c in db.query(SKUClassification).filter_by(store_id="CA_1")}
    assert set(cls) == set(CA_ITEMS)
    assert [cls[i].segment for i in CA_ITEMS] == CA_CLASSES
    assert {c.class_source for c in cls.values()} == {ltd.CLASS_SOURCE_TEACHER}
    assert rep["classes"]["removed_non_teacher"] == 1 and rep["classes"]["replaced_rows"] == 2
    # (b) dense daily sales [1031, 1941) with the M5 calendar
    n_days = T - 1031
    assert db.query(SalesHistory).count() == 4 * n_days == rep["sales"]["rows"]
    r = db.query(SalesHistory).filter_by(item_id="HOUSEHOLD_1_001", sale_date=date(2015, 5, 25)).one()
    assert r.quantity == float(y[3, 1577]) and r.id == "HOUSEHOLD_1_001_CA_1_2015-05-25"
    assert rep["sales"]["first_date"] == "2013-11-25" and rep["sales"]["last_date"] == "2016-05-22"
    # prices: only the non-positive one is filled
    assert db.get(Product, "FOODS_1_001").price == 3.5
    assert db.get(Product, "FOODS_1_002").price == pytest.approx(float(price[1].mean()), abs=1e-3)
    assert rep["prices"]["price_filled"] == 1
    # (c) 78 weekly origins x 4 SKUs, H = 10, all levels, 0.95 = level index 10
    fwq = db.query(ForecastWindowQuantile).all()
    assert len(fwq) == 78 * 4 and {r.horizon_days for r in fwq} == {10}
    assert {r.route for r in fwq} == {pc.ROUTE_TEACHER}
    one = [r for r in fwq if r.item_id == "FOODS_1_002" and r.origin_date == date(2015, 5, 25)][0]
    assert one.q_levels["0.95"] == pytest.approx(float(q[1577 - 1395, 1, 10]), abs=1e-3)
    assert len(one.q_levels) == 19
    # idempotent: a second run changes nothing in the counts, and a changed quantity is restored
    db.query(SalesHistory).filter_by(item_id="FOODS_1_001", sale_date=date(2015, 5, 25)).update({"quantity": 999})
    db.commit()
    ltd.run(db, tdir, "CA_1", steps=("classes", "sales", "quantiles"), log=lambda *_: None)
    assert db.query(SalesHistory).count() == 4 * n_days
    assert db.query(ForecastWindowQuantile).count() == 78 * 4
    assert db.query(SKUClassification).count() == 4
    assert db.query(SalesHistory).filter_by(item_id="FOODS_1_001", sale_date=date(2015, 5, 25)).one().quantity \
        == float(y[0, 1577])


def test_j5_and_j3_read_teacher_quantiles(teacher_dir, db):
    tdir, y, price, q = teacher_dir
    ltd.run(db, tdir, "CA_1", steps=("classes", "sales", "quantiles"), log=lambda *_: None)
    days = window_quantile_service.teacher_review_days(db, "CA_1", 10)
    assert days == list(range(1395, T, 7))
    cm = window_quantile_service.causal_quantile_matrix(db, "CA_1", CA_ITEMS, [1395, 1577, 1934], 0.95, 10)
    expect = np.stack([q[d - 1395, :4, 10] for d in (1395, 1577, 1934)], axis=1)
    np.testing.assert_allclose(cm["q"], expect, atol=1e-3)
    assert cm["teacher"].all()
    # J3 reuses the stored row (no rebuild) at a review origin
    recs = window_quantile_service.get_or_create_window_quantiles_bulk(db, "CA_1", CA_ITEMS, date(2015, 6, 1), 10)
    assert {r.route for r in recs.values()} == {pc.ROUTE_TEACHER}


def test_clock_step(teacher_dir, db):
    tdir, y, price, q = teacher_dir
    rep = ltd.run(db, tdir, "CA_1", steps=("classes", "sales", "quantiles", "clock"), initial_refit=True,
                  log=lambda *_: None)
    clock = db.get(SimClock, "CA_1")
    assert clock.start_date == clock.current_date == date(2015, 5, 25)
    th = db.query(CalibrationState).filter_by(store_id="CA_1", review_index=0).all()
    assert len(th) == 9 and {s.theta for s in th} == {0.0} and {s.review_date for s in th} == {date(2015, 5, 25)}
    inv = {i.item_id: i.on_hand for i in db.query(Inventory).filter_by(store_id="CA_1")}
    for k, iid in enumerate(CA_ITEMS):
        assert inv[iid] == np.round(y[k, 1577 - 28:1577].mean() * 10)
    assert inv["DROPPED_1_001"] == 0.0
    sel = rep["clock"]["initial_selection"]
    assert set(CA_CLASSES) <= set(sel)
    assert all(v[0] in pc.M_GRID and v[1] in pc.KAPPA_GRID for c, v in sel.items() if c in CA_CLASSES)
