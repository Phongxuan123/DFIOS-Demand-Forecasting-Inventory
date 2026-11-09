import sys
import os
import uuid
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import pandas as pd
from sqlalchemy import text
from app.core.database import engine

STORE_ID = "CA_1"
START_DATE = "2015-05-24"
CALIBRATOR_ID = "c3out_main_ca1"
now = datetime.now(timezone.utc)

with engine.begin() as conn:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS calibration_state (
            id VARCHAR(100) PRIMARY KEY,
            calibrator_id VARCHAR(100) NOT NULL,
            store_id VARCHAR(50) NOT NULL,
            class_id VARCHAR(10) NOT NULL,
            review_index INTEGER NOT NULL,
            review_date DATE NOT NULL,
            theta DOUBLE PRECISION DEFAULT 0.0,
            multiplier DOUBLE PRECISION DEFAULT 1.0,
            error_rate DOUBLE PRECISION DEFAULT 0.04,
            at_boundary BOOLEAN DEFAULT FALSE,
            setpoint DOUBLE PRECISION DEFAULT 0.96,
            eta DOUBLE PRECISION DEFAULT 1.0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_calib_state ON calibration_state (store_id, class_id, review_index);
    """))

CLASSES = ["AX", "AY", "AZ", "BX", "BY", "BZ", "CX", "CY", "CZ"]

records = []
for c in CLASSES:
    records.append({
        "id": f"{STORE_ID}_{c}_rev_0",
        "calibrator_id": CALIBRATOR_ID,
        "store_id": STORE_ID,
        "class_id": c,
        "review_index": 0,
        "review_date": START_DATE,
        "theta": 0.0,
        "multiplier": 1.0,
        "error_rate": 0.04,
        "at_boundary": False,
        "setpoint": 0.96,
        "eta": 1.0,
        "created_at": now
    })

df = pd.DataFrame(records)

with engine.begin() as conn:
    conn.execute(text("DELETE FROM calibration_state WHERE store_id = :s AND review_index = 0"), {"s": STORE_ID})

df.to_sql("calibration_state", engine, if_exists="append", index=False)
print(f"Seeded {len(df)} calibration_state records for {STORE_ID} at review_index 0 (theta=0.0)!")
