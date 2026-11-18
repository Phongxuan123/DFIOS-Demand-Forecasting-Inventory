"""
P3 quality metrics (app/services/quality_metrics_service.py, GET /api/v1/metrics/*):
  * forecast quality (G-30): coverage, SPL, window MASE of the median, median bias (teacher E3 formulas);
  * controller monitoring (G-19 rolling violation, G-21 recovery, Warm-up/Active/Boundary status).
Hand-computed values on tiny synthetic data (SQLite in memory only), plus an OPTIONAL regression against the
teacher's E3 numbers (Ensemble, H = 10, 3 stores, daily test origins) that is skipped when TEACHER_DIR is absent.
"""
import csv
import math
import os
from datetime import date, timedelta

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db, require_manager_or_admin
from app.main import app
from app.models.base import Base
from app.models.calibration_state import CalibrationState
from app.models.forecast_window_quantile import ForecastWindowQuantile
from app.models.sales_history import SalesHistory
from app.models.service_outcomes import ServiceOutcome
from app.services import policy_config as pc
from app.services.quality_metrics_service import (
    TEACHER_LEVELS, compute_forecast_quality, recovery_days, scales_s1, service_metrics,
)

# ---------------------------------------------------------------------------------------------- synthetic data
# 2 SKUs, days 0..5, H = 2, origins 3 and 4, levels (0.5, 0.9).
Y = np.array([[0, 2, 1, 3, 0, 2],
              [1, 1, 1, 1, 1, 1]], dtype=float)
LEVELS = [0.5, 0.9]
ORIGINS = [3, 4]
Q = np.array([[[2.0, 4.0], [2.0, 2.0]],     # origin 3: SKU0, SKU1
              [[3.0, 5.0], [1.0, 1.5]]])    # origin 4
# windows: SKU0 -> 3, 2 ; SKU1 -> 2, 2


def test_scale_s1_from_first_sale():
    s1 = scales_s1(Y, 3)
    # SKU0: first sale day 1, diffs from day 1: |1-2| = 1 -> s1 = 1; SKU1: all diffs 0 -> NaN
    assert s1[0] == pytest.approx(1.0)
    assert math.isnan(s1[1])


def test_forecast_quality_hand_computed():
    r = compute_forecast_quality(Y, Q, LEVELS, ORIGINS, H=2, scale=scales_s1(Y, 3))
    assert r["n_windows"] == 4 and r["n_origins"] == 2 and r["n_sku_scaled"] == 1
    # coverage only at stored levels of the E3 set
    assert set(r["coverage"]) == {"0.5", "0.9"}
    assert r["coverage"]["0.9"] == pytest.approx(3 / 4)    # 3<=4, 2<=5, 2<=2, 2>1.5
    assert r["coverage"]["0.5"] == pytest.approx(2 / 4)    # 3>2, 2<=3, 2<=2, 2>1
    # SKU0 pinball: o3 0.5 + 0.1, o4 0.5 + 0.3 -> mean 0.35; / (H * s1) = /2 -> 0.175 (SKU1 has no scale)
    assert r["spl"] == pytest.approx(0.175)
    # SKU0 |median - Y|: 1, 1 -> 1 / 2 = 0.5
    assert r["mase_median"] == pytest.approx(0.5)
    # medians 2+2+3+1 = 8 vs actual 9
    assert r["median_bias_pct"] == pytest.approx(100 * (8 / 9 - 1))


def test_forecast_quality_drops_missing_windows_and_default_scale():
    y = Y.copy()
    y[1, 5] = np.nan                       # SKU1 window of origin 4 unknown -> dropped, never counted as 0
    r = compute_forecast_quality(y, Q, LEVELS, ORIGINS, H=2)  # default scale: history before origin 3
    assert r["n_windows"] == 3
    assert r["coverage"]["0.9"] == pytest.approx(1.0)
    assert r["spl"] == pytest.approx(0.175)
    # windows leaving y are skipped
    r2 = compute_forecast_quality(Y, np.concatenate([Q, Q[:1]]), LEVELS, ORIGINS + [5], H=2)
    assert r2["n_origins"] == 2


# A: 0,0,.2,.2,0,0,0 -> rolling (4) shares .1,.1,.1,.05 -> availability .90,.90,.90,.95 -> 3 of 4 violate (> 1pp)
# B: .04 everywhere -> availability .96 -> never violates
ERR_A = [0, 0, .2, .2, 0, 0, 0]
ERR_B = [.04] * 7


def test_service_metrics_rolling_violation():
    sm = service_metrics(np.array([ERR_A, ERR_B]).T)
    assert sm["n_windows"] == 4
    assert sm["class_rolling_violation"] == pytest.approx([0.75, 0.0])
    assert sm["rolling_violation"] == pytest.approx(3 / 8)
    assert sm["rolling_worst"] == pytest.approx(0.05)
    assert sm["class_csl"] == pytest.approx([1 - 0.4 / 7, 0.96])
    assert sm["min_class_csl"] == pytest.approx(1 - 0.4 / 7)
    assert sm["feasible"] is False and sm["feasible_1pp"] is True
    assert sm["class_last_rolling"] == pytest.approx([0.95, 0.96])
    # fewer than 4 cycles: no window
    assert service_metrics(np.array([[0.1], [0.1]]))["rolling_violation"] is None


def test_recovery_days_hand_computed_and_censored():
    # 10 cycles, R = 7, L = 3: review day 7k, cycle end 7k + 9; cycles 0..3 share .2, then .05
    days = np.arange(10) * 7
    ends = days + 9
    e = np.array([.2] * 4 + [.05] * 6)[:, None]
    # windows 4, 5, 6 are the first three good ones (|1 - .05 - .95| = 0) with review day >= 10
    # -> last day of cycle 4 + 4 + 3 - 2 = 9 is 72; 72 + 1 - 10 = 63
    assert recovery_days(days, ends, e, event_day=10) == pytest.approx(63.0)
    assert math.isnan(recovery_days(days, ends, e, event_day=30))   # censored -> NaN, never 0
    assert math.isnan(recovery_days(days[:5], ends[:5], e[:5], event_day=0))


# ---------------------------------------------------------------------------------------------- DB / endpoints
T0 = date(2016, 1, 4)  # first review day


@pytest.fixture()
def client_db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)

    def _db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[require_manager_or_admin] = lambda: object()
    try:
        yield TestClient(app), Session
    finally:
        app.dependency_overrides.clear()


def _seed_outcomes(db):
    for k in range(7):
        start = T0 + timedelta(days=7 * k + 3)
        for cls, n_sku, n_so in (("AX", 10, int(round(ERR_A[k] * 10))), ("AY", 25, 1)):
            db.add(ServiceOutcome(id=f"CA_1_{cls}_{k}", calibrator_id="c", store_id="CA_1", class_id=cls,
                                  cycle_index=k, cycle_start=start, cycle_end=start + timedelta(days=6),
                                  n_sku=n_sku, n_stockout=n_so, error_rate=n_so / n_sku))
    db.add(CalibrationState(id="ax", calibrator_id="c", store_id="CA_1", class_id="AX", review_index=8,
                            review_date=T0 + timedelta(days=56), theta=2.0, error_rate=0.2, at_boundary=True))
    db.add(CalibrationState(id="ay", calibrator_id="c", store_id="CA_1", class_id="AY", review_index=8,
                            review_date=T0 + timedelta(days=56), theta=0.5, error_rate=0.04))
    db.add(CalibrationState(id="bx", calibrator_id="c", store_id="CA_1", class_id="BX", review_index=1,
                            review_date=T0 + timedelta(days=7), theta=0.0, error_rate=None))
    db.commit()


def test_controller_endpoint(client_db):
    client, Session = client_db
    with Session() as db:
        _seed_outcomes(db)
    r = client.get("/api/v1/metrics/controller", params={"store_id": "CA_1", "event_date": T0.isoformat()})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["n_complete_cycles"] == 7 and body["classes_evaluated"] == ["AX", "AY"]
    ov = body["overall"]
    assert ov["rolling_violation"] == pytest.approx(3 / 8)
    assert ov["min_class_csl"] == pytest.approx(1 - 0.4 / 7)
    # mean class gap per window .03,.03,.03,.005 -> never 3 good windows -> censored
    assert ov["recovery_days"] is None and ov["recovery_censored"] is True
    cl = body["classes"]
    assert cl["AX"]["rolling_violation"] == pytest.approx(0.75) and cl["AX"]["violating_windows"] == 3
    assert cl["AY"]["rolling_violation"] == pytest.approx(0.0)
    assert cl["AY"]["availability"] == pytest.approx(0.96)
    # AY alone: every window gap .01 <= .02, first window review day = T0 >= event -> end of cycle 0 + 5 = 5:
    # T0 + 7*5 + 3 + 6 = T0 + 44 -> 44 + 1 - 0 = 45 days
    assert cl["AY"]["recovery_days"] == pytest.approx(45.0)
    assert cl["AX"]["recovery_days"] is None
    assert cl["AX"]["status"] == "Boundary" and cl["AY"]["status"] == "Active"
    assert cl["BX"]["status"] == "Warm-up" and cl["AZ"]["status"] == "Warm-up" and cl["AZ"]["n_sku"] == 0
    # empty store
    r2 = client.get("/api/v1/metrics/controller", params={"store_id": "TX_1"})
    assert r2.status_code == 200 and r2.json()["overall"] is None


def test_forecast_quality_endpoint(client_db):
    client, Session = client_db
    items = ["A", "B"]
    with Session() as db:
        for i, iid in enumerate(items):
            for t in range(Y.shape[1]):
                db.add(SalesHistory(id=f"{iid}_{t}", item_id=iid, store_id="CA_1",
                                    sale_date=pc.day_index_to_date(t), quantity=float(Y[i, t])))
            for k, o in enumerate(ORIGINS):
                db.add(ForecastWindowQuantile(
                    id=f"run_{iid}_{o}", model_run_id="run", store_id="CA_1", item_id=iid,
                    origin_date=pc.day_index_to_date(o), horizon_days=2, point_window=float(Q[k, i, 0]),
                    q_levels={str(lv): float(Q[k, i, j]) for j, lv in enumerate(LEVELS)}))
        db.commit()
    r = client.get("/api/v1/metrics/forecast-quality", params={"store_id": "CA_1", "horizon_days": 2})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["status"] == "ok" and b["model_run_id"] == "run" and b["levels_source"] == "stored_common"
    assert b["n_windows"] == 4 and b["n_items_used"] == 2
    assert b["coverage"]["0.9"] == pytest.approx(0.75)
    assert b["spl"] == pytest.approx(0.175)
    assert b["mase_median"] == pytest.approx(0.5)
    assert b["median_bias_pct"] == pytest.approx(100 * (8 / 9 - 1))
    # cap: one origin (the first of the evenly spaced selection)
    b1 = client.get("/api/v1/metrics/forecast-quality",
                    params={"store_id": "CA_1", "horizon_days": 2, "max_origins": 1}).json()
    assert b1["n_origins"] == 1 and b1["origin_selection"] == "evenly spaced 1"
    assert b1["coverage"]["0.9"] == pytest.approx(1.0)       # origin 3: 3<=4, 2<=2
    # no rows
    assert client.get("/api/v1/metrics/forecast-quality", params={"store_id": "WI_1"}).json()["status"] == "no_data"


# ---------------------------------------------------------------------------------------------- teacher regression
TEACHER_DIR = os.environ.get("TEACHER_DIR", r"C:\DATN\26FA_SET490_Inventory")
_Y = os.path.join(TEACHER_DIR, "c3out_experiments", "data", "m5_prepared", "y.npy")
_FD = os.path.join(TEACHER_DIR, "DFIOS", "results", "forecasts", "ensemble")


@pytest.mark.skipif(not (os.path.isfile(_Y) and os.path.isfile(os.path.join(_FD, "Q_H10.npy"))),
                    reason="teacher data (TEACHER_DIR) not available")
def test_teacher_e3_ensemble_h10_regression():
    """Ensemble Q_H10, all 3 stores (8,831 SKUs), teacher protocol: daily test origins o >= 1577 with o + 10 <= 1941
    (355 origins), scale s1 from history before day 1395, 19 stored levels. Read-only numpy mmap."""
    y = np.asarray(np.load(_Y, mmap_mode="r"), dtype=float)
    origins = np.asarray(np.load(os.path.join(_FD, "origins.npy"), mmap_mode="r"))
    Qm = np.load(os.path.join(_FD, "Q_H10.npy"), mmap_mode="r")
    assert Qm.shape[2] == len(TEACHER_LEVELS)
    rows = np.flatnonzero((origins >= 1577) & (origins + 10 <= y.shape[1]))
    r = compute_forecast_quality(y, Qm, TEACHER_LEVELS, origins, 10, scales_s1(y, 1395), rows=rows)
    assert r["n_origins"] == 355 and r["n_sku"] == 8831
    assert abs(r["coverage"]["0.95"] - 0.9396) < 0.003
    assert abs(r["spl"] - 0.1292) < 0.003
    csv_path = os.path.join(TEACHER_DIR, "DFIOS", "results", "e2_e3", "e3_window_coverage.csv")
    if os.path.isfile(csv_path):
        with open(csv_path, newline="", encoding="utf-8") as f:
            ref = next(row for row in csv.DictReader(f) if row["model"] == "ensemble" and row["H"] == "10")
        assert r["coverage"]["0.95"] == pytest.approx(float(ref["cov_0.95"]), abs=1e-9)
        assert r["spl"] == pytest.approx(float(ref["spl"]), abs=1e-9)
        assert r["mase_median"] == pytest.approx(float(ref["mase_median"]), abs=1e-9)
        assert r["median_bias_pct"] == pytest.approx(float(ref["median_bias_pct"]), abs=1e-4)
        for t in ("0.5", "0.8", "0.9", "0.99"):
            assert r["coverage"][t] == pytest.approx(float(ref[f"cov_{t}"]), abs=1e-9)
