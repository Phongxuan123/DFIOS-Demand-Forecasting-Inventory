"""
Tier-3 C3-OUT state (calibration_state).

P-35 / N-11: dated on the ONE demo convention (policy_config.DEMO_START_DATE).
Teacher-aligned (G-17): the live controller always starts from the neutral state theta = 0 at review 0
(one-sided C3-OUT, theta_0 = 0). The old two-sided artifact trajectory (c3ok_theta.csv) is NOT warm-started;
the simulator builds the trajectory from real service outcomes.
"""
import os
import sys
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

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
if not records:
    for c in pc.ALL_CLASSES:
        records.append({
            "id": f"{STORE_ID}_{c}_rev_0", "calibrator_id": CALIBRATOR_ID, "store_id": STORE_ID, "class_id": c,
            "review_index": 0, "review_date": pc.DEMO_START_DATE, "theta": pc.THETA_INIT, "multiplier": 1.0,
            "error_rate": None, "at_boundary": False, "setpoint": pc.C3_SETPOINT,
            "eta": pc.CONTROLLER_ETA, "created_at": now,
        })
    print("Neutral initial state theta = 0 at review 0 (no artifact warm-start)")

df = pd.DataFrame(records)
with engine.begin() as conn:
    conn.execute(text("DELETE FROM calibration_state WHERE store_id = :s"), {"s": STORE_ID})
df.to_sql("calibration_state", engine, if_exists="append", index=False)
print(f"Seeded {len(df)} calibration_state records for {STORE_ID}.")
