import sys
import os
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import pandas as pd
from sqlalchemy import text
from app.core.database import engine

STORE_ID = "CA_1"
CALIBRATOR_ID = "c3out_main_ca1"
now = datetime.now(timezone.utc)

with engine.begin() as conn:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS service_outcomes (
            id VARCHAR(100) PRIMARY KEY,
            calibrator_id VARCHAR(100) NOT NULL,
            store_id VARCHAR(50) NOT NULL,
            class_id VARCHAR(10) NOT NULL,
            cycle_index INTEGER NOT NULL,
            cycle_start DATE NOT NULL,
            cycle_end DATE NOT NULL,
            n_sku INTEGER DEFAULT 0,
            n_stockout INTEGER DEFAULT 0,
            error_rate DOUBLE PRECISION DEFAULT 0.0,
            consumed_at_review INTEGER,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_service_outcomes ON service_outcomes (store_id, class_id, cycle_index);
    """))

CLASSES = ["AX", "AY", "AZ", "BX", "BY", "BZ", "CX", "CY", "CZ"]
CYCLE_START = "2015-05-17"
CYCLE_END = "2015-05-24"

records = []
for c in CLASSES:
    records.append({
        "id": f"{STORE_ID}_{c}_cycle_0",
        "calibrator_id": CALIBRATOR_ID,
        "store_id": STORE_ID,
        "class_id": c,
        "cycle_index": 0,
        "cycle_start": CYCLE_START,
        "cycle_end": CYCLE_END,
        "n_sku": 100,
        "n_stockout": 4,
        "error_rate": 0.04,
        "consumed_at_review": 1,
        "created_at": now
    })

df = pd.DataFrame(records)

with engine.begin() as conn:
    conn.execute(text("DELETE FROM service_outcomes WHERE store_id = :s AND cycle_index = 0"), {"s": STORE_ID})

df.to_sql("service_outcomes", engine, if_exists="append", index=False)
print(f"Seeded {len(df)} service_outcomes baseline records for {STORE_ID}!")
