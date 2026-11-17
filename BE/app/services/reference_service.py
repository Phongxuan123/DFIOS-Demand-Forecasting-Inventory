"""Reference match card: replay of the teacher's E10b Table 17 vs the published benchmark.

The replay JSON is produced offline by ``scripts/replay_e10b.py`` (not stored in git).
"""
import json
import math
import os
from typing import Any

from app.core.config import BASE_DIR

DEFAULT_PATH = os.path.join(BASE_DIR, "MODEL", "e10b_reference.json")

TEACHER = {
    "cost": 719971.2, "holding": 467614.3, "lost": 67794.9, "ordering": 184562.0,
    "fill": 0.98506, "min_class_csl": 0.95979, "orders": 92281, "n_cycles": 51, "n_skus": 8831,
}
TOL = {"cost": 1.0, "fill": 1e-5, "min_class_csl": 1e-4, "orders": 0}
_METRICS = ("cost", "holding", "lost", "ordering", "fill", "min_class_csl", "orders", "n_cycles", "n_skus")
_REQUIRED = ("cost", "holding", "lost", "ordering", "fill", "min_class_csl", "orders", "n_cycles")


def reference_path() -> str:
    return os.getenv("E10B_REFERENCE_JSON") or DEFAULT_PATH


def _num(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return None
    return float(v)


def get_e10b_reference() -> dict:
    path = reference_path()
    if not os.path.isfile(path):
        return {"available": False, "message": "Reference file not found; run scripts/replay_e10b.py to produce it."}
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        if isinstance(raw, list):  # multi-policy output: take the E10b policy
            raw = next((r for r in raw if isinstance(r, dict) and r.get("policy") == "REFIT-RSS-EOQ-G"), None)
        if not isinstance(raw, dict):
            raise ValueError("unexpected JSON shape")
        replay = {k: _num(raw.get(k)) for k in _METRICS if k in raw or k in _REQUIRED}
        missing = [k for k in _REQUIRED if replay.get(k) is None]
        if missing:
            raise ValueError(f"missing/invalid fields: {', '.join(missing)}")
    except (OSError, ValueError) as exc:
        return {"available": False, "message": f"Reference file is invalid: {exc}"}

    schedule = []
    sel = raw.get("selection")
    for item in (sel.get("schedule") if isinstance(sel, dict) else None) or []:
        if isinstance(item, dict):
            schedule.append({"start": item.get("start"), "m": item.get("m"), "kappa": item.get("kappa")})

    deltas = {k: (replay[k] - TEACHER[k]) if replay.get(k) is not None else None for k in _METRICS if k in TEACHER}
    checks = {k: deltas[k] is not None and abs(deltas[k]) <= TOL[k] for k in TOL}
    return {
        "available": True,
        "policy": raw.get("policy") if isinstance(raw.get("policy"), str) else None,
        "classes": raw.get("classes") if isinstance(raw.get("classes"), list) else None,
        "replay": replay,
        "teacher": TEACHER,
        "delta": deltas,
        "checks": checks,
        "tolerance": TOL,
        "matches": all(checks.values()),
        "selection_schedule": schedule,
    }
