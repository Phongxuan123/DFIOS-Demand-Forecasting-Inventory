"""
Tier-3 C3-OUT state (calibration_state).

P-35 / N-11: dated on the ONE demo convention (policy_config.DEMO_START_DATE).
The theta TRAJECTORY is kept (never collapsed to a single value):
  * if the artifact trajectory ``c3ok_theta.csv`` (policy "P C3-OUT tau=0.95") is available next to the other
    artifacts, one row per review (review_day <= demo start, causal) is loaded with the real review dates;
  * otherwise a neutral initial state theta = 0 at review 0 (the simulator then builds the trajectory).
"""
import os
import sys
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import math
import pandas as pd
from sqlalchemy import text
from app.core.database import engine
from app.models.calibration_state import CalibrationState
from app.services import policy_config as pc

STORE_ID = pc.DEMO_STORE_ID
CALIBRATOR_ID = f"c3out_main_{STORE_ID}"
POLICY_NAME = "P C³-OUT τ=0.95"
now = datetime.now(timezone.utc)

CalibrationState.__table__.create(bind=engine, checkfirst=True)


def _find_theta_csv():
    cands = [os.getenv("DFIOS_ARTIFACTS_DIR"), SCRIPT_DIR, os.path.join(SCRIPT_DIR, "..", "MODEL")]
    for d in cands:
        if d and os.path.exists(os.path.join(d, "c3ok_theta.csv")):
            return os.path.join(d, "c3ok_theta.csv")
    return None


records = []
path = _find_theta_csv()
if path:
    th = pd.read_csv(path, encoding="utf-8")
    th = th[th["policy"] == POLICY_NAME].sort_values("review_day")
    th = th[th["review_day"] <= pc.date_to_day_index(pc.DEMO_START_DATE)]
    for k, (_, row) in enumerate(th.iterrows()):
        for c in pc.ALL_CLASSES:
            theta = float(row[c])
            records.append({
                "id": f"{STORE_ID}_{c}_rev_{k}", "calibrator_id": CALIBRATOR_ID, "store_id": STORE_ID,
                "class_id": c, "review_index": k, "review_date": pc.day_index_to_date(int(row["review_day"])),
                "theta": theta, "multiplier": round(math.exp(theta), 4), "error_rate": None,
                "at_boundary": bool(abs(theta) >= pc.THETA_MAX), "setpoint": pc.TARGET_AVAILABILITY,
                "eta": pc.CONTROLLER_ETA, "created_at": now,
            })
    print(f"Loaded artifact theta trajectory: {len(th)} reviews from {path}")
if not records:
    for c in pc.ALL_CLASSES:
        records.append({
            "id": f"{STORE_ID}_{c}_rev_0", "calibrator_id": CALIBRATOR_ID, "store_id": STORE_ID, "class_id": c,
            "review_index": 0, "review_date": pc.DEMO_START_DATE, "theta": 0.0, "multiplier": 1.0,
            "error_rate": None, "at_boundary": False, "setpoint": pc.TARGET_AVAILABILITY,
            "eta": pc.CONTROLLER_ETA, "created_at": now,
        })
    print("No artifact theta trajectory found: neutral initial state theta = 0 at review 0")

df = pd.DataFrame(records)
with engine.begin() as conn:
    conn.execute(text("DELETE FROM calibration_state WHERE store_id = :s"), {"s": STORE_ID})
df.to_sql("calibration_state", engine, if_exists="append", index=False)
print(f"Seeded {len(df)} calibration_state records for {STORE_ID}.")
