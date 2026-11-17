"""
Reader of the M5 C3-OUT experiment artifact (``c3ok_results.csv``) used by the what-if simulation and by
``GET /reports/policy-comparison``.

The artifact is a RESULT of an offline run (FULL mode): 25,950 SKUs (``c3ok_sku_class.csv``), 72 reviews
of which the last 51 are the test window (days 1579..1935 => 357 days), L = 3, R = 7.
Nothing here is simulated by the API: callers must label the numbers ``source = "artifact_extract"``.

If the file cannot be found a ``ArtifactMissingError`` is raised. There are NO embedded fallback constants
(N-01 / P-15): a missing artifact is an explicit error, never silently replaced by numbers typed in code.
"""
from __future__ import annotations

import csv
import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional

from app.core.config import settings

_BE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_REPO_DIR = os.path.abspath(os.path.join(_BE_DIR, ".."))

# Test window of the artifact (RUN_SUMMARY_C3OK.md: "72 kỳ, test 51 kỳ, ngày 1579…1935", R = 7)
ARTIFACT_TEST_REVIEWS = 51
ARTIFACT_REVIEW_PERIOD_DAYS = 7
ARTIFACT_TEST_DAYS = ARTIFACT_TEST_REVIEWS * ARTIFACT_REVIEW_PERIOD_DAYS  # 357

# canonical policy key -> (row name in c3ok_results.csv, display label, short description).
# The keys (B0, B2, PCR, P6) and the artifact row names are stable identifiers; only the display texts say what
# each row really is: "B0" of the artifact is the team's raw-quantile baseline RAW-0.95 (NOT the teacher's
# B0-MA-OUT-0.95), B2 is the raw quantile at the validation-picked tau* = 0.99 (identical to raw tau = 0.99, NOT
# the critical ratio), and P-CR is C3-OUT with setpoint = critical ratio b/(b+h*R) = 0.9615 (R = review period),
# not a separately proven cost optimum.
POLICY_ROWS = {
    "B0": (
        "B0 DFIOS τ=0.95",
        "RAW-0.95 - Raw quantile τ=0.95 (DFIOS gốc)",
        "Baseline tĩnh (RAW-0.95, không phải B0 của thầy): s = Q̂ raw của cửa sổ L+R ở τ=0.95, "
        "không hiệu chỉnh theo chu kỳ.",
    ),
    "B2": (
        "B2 DFIOS τ*=0.99 [BIKIP]",
        "B2 - Raw quantile τ*=0.99 (τ* chọn trên validation; không phải critical ratio 0.9615)",
        "Baseline raw quantile tĩnh ở τ* chọn trên lưới validation (ở đây 0.99, số liệu trùng raw τ=0.99). "
        "τ* KHÔNG phải critical ratio (0.9615); không có controller.",
    ),
    "PCR": (
        "P-CR C³-OUT τ=0.9615 [BIKIP]",
        "P-CR - C³-OUT với setpoint = critical ratio (τ=0.9615)",
        "Bộ điều khiển C³-OUT có setpoint = critical ratio τ = b/(b+h·R) = 0.9615 (R = chu kỳ review, chi phí A3). "
        "Là C³-OUT với setpoint khác, không phải tối ưu chi phí đã được chứng minh riêng.",
    ),
    "P6": (
        "P C³-OUT τ=0.95",
        "P6 - C³-OUT τ=0.95 (bộ điều khiển mức phục vụ)",
        "Bộ điều khiển tích phân θ_g bám mức phục vụ mục tiêu 0.95; KHÔNG phải bộ giảm chi phí.",
    ),
}


class ArtifactMissingError(RuntimeError):
    """c3ok_results.csv (or one of its policy rows) could not be found."""


@dataclass
class PolicyRow:
    key: str
    artifact_row: str
    label: str
    description: str
    tau: float
    csl: float
    fill_rate: float
    holding_bikip: float
    shortage_bikip: float
    ordering_bikip: float
    cost_bikip: float
    cost_paper: float


@dataclass
class ArtifactResults:
    path: str
    n_skus: Optional[int]
    n_days: int
    n_reviews: int
    as_of: str
    policies: Dict[str, PolicyRow] = field(default_factory=dict)
    csl_by_class: Dict[str, Dict[str, float]] = field(default_factory=dict)  # policy row -> class -> CSL


def _candidate_dirs() -> List[str]:
    dirs: List[str] = []
    for env_dir in (os.getenv("DFIOS_C3OK_DIR", ""), getattr(settings, "ARTIFACTS_DIR", "") or ""):
        if env_dir:
            dirs.append(env_dir)
    dirs += [
        os.path.join(_BE_DIR, "MODEL"),
        os.path.join(_BE_DIR, "scripts"),
        os.path.join(_REPO_DIR, "RESULT_FULL (C3out)", "c3ok_artifacts", "c3ok_artifacts"),
    ]
    return dirs


def find_artifact(name: str) -> Optional[str]:
    for d in _candidate_dirs():
        p = os.path.abspath(os.path.join(d, name))
        if os.path.isfile(p):
            return p
    return None


def _f(row: Dict[str, str], key: str) -> float:
    return float(row[key])


def load_results() -> ArtifactResults:
    """Parse c3ok_results.csv. Raises ArtifactMissingError when missing / incomplete."""
    path = find_artifact("c3ok_results.csv")
    if not path:
        raise ArtifactMissingError(
            "Không tìm thấy c3ok_results.csv (đã tìm trong DFIOS_C3OK_DIR, DFIOS_ARTIFACTS_DIR, BE/MODEL, "
            "BE/scripts, RESULT_FULL (C3out)). Không dùng số liệu nhúng sẵn trong code."
        )
    rows: Dict[str, Dict[str, str]] = {}
    with open(path, "r", encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh):
            rows[r.get("policy", "")] = r

    policies: Dict[str, PolicyRow] = {}
    for key, (row_name, label, desc) in POLICY_ROWS.items():
        r = rows.get(row_name)
        if r is None:
            raise ArtifactMissingError(f"c3ok_results.csv thiếu dòng chính sách '{row_name}' ({path}).")
        policies[key] = PolicyRow(
            key=key, artifact_row=row_name, label=label, description=desc,
            tau=_f(r, "tau"), csl=_f(r, "CSL"), fill_rate=_f(r, "fill_rate"),
            holding_bikip=_f(r, "hold_BIKIP"), shortage_bikip=_f(r, "lost_BIKIP"),
            ordering_bikip=_f(r, "order_BIKIP"), cost_bikip=_f(r, "cost_BIKIP"), cost_paper=_f(r, "cost_PAPER"),
        )

    n_skus: Optional[int] = None
    cls_path = find_artifact("c3ok_sku_class.csv")
    if cls_path:
        with open(cls_path, "r", encoding="utf-8") as fh:
            n_skus = max(0, sum(1 for _ in fh) - 1)

    csl_by_class: Dict[str, Dict[str, float]] = {}
    csl_path = find_artifact("c3ok_csl_by_class.csv")
    if csl_path:
        with open(csl_path, "r", encoding="utf-8", newline="") as fh:
            for r in csv.DictReader(fh):
                csl_by_class.setdefault(r["policy"], {})[r["class"]] = float(r["CSL"])

    as_of = datetime.fromtimestamp(os.path.getmtime(path), tz=timezone.utc).date().isoformat()
    return ArtifactResults(
        path=path, n_skus=n_skus, n_days=ARTIFACT_TEST_DAYS, n_reviews=ARTIFACT_TEST_REVIEWS,
        as_of=as_of, policies=policies, csl_by_class=csl_by_class,
    )


def artifact_config() -> Dict[str, object]:
    path = find_artifact("c3ok_config.json")
    if not path:
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)
