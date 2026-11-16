"""
Empirical coverage of the Q0.95 protection-window quantile. Both fields use the SAME definition: the share of
(SKU, origin) 10-day (L+R) protection windows whose realised window total demand is <= the Q0.95 of that window.
They are TWO distinct measurements (different forecasts, calibration and sample) and are never merged:

* ``coverage_q95`` / ``coverage_source = "artifact:c3ok"``: measured OFFLINE by the C3-OUT pipeline on the M5
  test split (25,950 SKUs, artifact forecasts), step "Quantile DFIOS & hieu chuan" of the run log
  (``c3ok_forecast_calibration.csv``, row ``test``, column ``cover_0.95`` ~ 0.8314; validation 0.8478,
  10-day bias -4.42 %). Pure artifact extract. The log does not state whether this is before or after the
  pipeline's calibration step, so nothing is claimed either way.
* ``coverage_q95_db_causal``: measured on THIS database from the route-(c) causal quantiles stored in
  ``forecast_window_quantile`` (empirical residual quantile of matured windows): realised window demand from
  ``sales_history`` / M5 CSV, only windows whose H days are all known (e.g. CA_1, 3,049 SKUs).
The numbers are not expected to match (different forecasts / calibration / sample); both are compared with the
same O2 band [0.93, 0.97]. See docs/API_CHANGES.md ("Follow-up agent").
"""
from __future__ import annotations

import csv
import logging
import threading
from typing import Any, Dict, Optional

import numpy as np
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.forecast_window_quantile import ForecastWindowQuantile
from app.services import policy_config as pc
from app.services.policy_artifact import find_artifact

logger = logging.getLogger(__name__)

CALIBRATION_FILE = "c3ok_forecast_calibration.csv"
ARTIFACT_SOURCE = "artifact:c3ok"
DB_SOURCE = "db:forecast_window_quantile"

_lock = threading.Lock()
_db_cache: Dict[Any, Dict[str, Any]] = {}


def artifact_coverage_q95() -> Optional[Dict[str, Any]]:
    path = find_artifact(CALIBRATION_FILE)
    if not path:
        return None
    try:
        with open(path, "r", encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                if str(next(iter(row.values()), "")).strip().lower() == "test":
                    return {"value": round(float(row["cover_0.95"]), 4), "split": "test", "file": CALIBRATION_FILE}
    except (OSError, KeyError, ValueError):
        logger.warning("cannot read %s", path, exc_info=True)
    return None


def db_causal_coverage_q95(db: Session, store_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Share of complete matured windows with actual <= stored Q0.95 (None when no complete window exists)."""
    from app.services.window_quantile_service import build_actuals_matrix, window_sums

    q = db.query(func.count(ForecastWindowQuantile.id))
    if store_id:
        q = q.filter(ForecastWindowQuantile.store_id == store_id)
    n_rows = int(q.scalar() or 0)
    if n_rows == 0:
        return None
    key = (store_id or "*", n_rows)
    with _lock:
        if key in _db_cache:
            return _db_cache[key]

    rq = db.query(
        ForecastWindowQuantile.store_id, ForecastWindowQuantile.item_id,
        ForecastWindowQuantile.origin_date, ForecastWindowQuantile.horizon_days,
        ForecastWindowQuantile.q_levels,
    )
    if store_id:
        rq = rq.filter(ForecastWindowQuantile.store_id == store_id)
    groups: Dict[Any, list] = {}
    for sid, iid, od, H, ql in rq.all():
        q95 = (ql or {}).get("0.95")
        if q95 is None:
            continue
        groups.setdefault((sid, od, int(H)), []).append((iid, float(q95)))

    covered = total = 0
    origins = set()
    for (sid, od, H), items in groups.items():
        o_idx = pc.date_to_day_index(od)
        ids = [i for i, _ in items]
        A = build_actuals_matrix(db, sid, ids, o_idx, o_idx + H)
        act = window_sums(A, np.array([0]), H)[:, 0]
        qv = np.array([v for _, v in items])
        ok = ~np.isnan(act)
        if ok.any():
            origins.add((sid, od))
            covered += int(np.sum(act[ok] <= qv[ok] + 1e-9))
            total += int(ok.sum())
    out = None
    if total:
        out = {"value": round(covered / total, 4), "n_windows": total, "n_origins": len(origins), "source": DB_SOURCE}
    with _lock:
        if len(_db_cache) > 32:
            _db_cache.clear()
        _db_cache[key] = out
    return out


def coverage_fields(db: Optional[Session], store_id: Optional[str] = None) -> Dict[str, Any]:
    art = artifact_coverage_q95()
    out: Dict[str, Any] = {
        "coverage_q95": art["value"] if art else None,
        "coverage_source": ARTIFACT_SOURCE if art else None,
        "coverage_q95_db_causal": None,
        "coverage_q95_db_causal_n": None,
        "coverage_q95_db_causal_source": None,
    }
    if db is not None:
        try:
            dbc = db_causal_coverage_q95(db, store_id)
        except Exception:  # noqa: BLE001 - optional enrichment must never break the host endpoint
            logger.warning("db causal coverage failed", exc_info=True)
            dbc = None
        if dbc:
            out["coverage_q95_db_causal"] = dbc["value"]
            out["coverage_q95_db_causal_n"] = dbc["n_windows"]
            out["coverage_q95_db_causal_source"] = dbc["source"]
    return out
