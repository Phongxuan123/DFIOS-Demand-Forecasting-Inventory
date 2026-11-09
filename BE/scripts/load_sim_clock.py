import sys
import os
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import pandas as pd
from sqlalchemy import text
from app.core.database import engine

with engine.begin() as conn:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS sim_clock (
            store_id VARCHAR(50) PRIMARY KEY,
            "current_date" DATE NOT NULL,
            start_date DATE NOT NULL,
            mode VARCHAR(20) DEFAULT 'replay',
            speed DOUBLE PRECISION DEFAULT 1.0,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
    """))

STORES = ["CA_1", "TX_1", "WI_1"]
START_DATE = "2015-05-24"
now = datetime.now(timezone.utc)

records = []
for s in STORES:
    records.append({
        "store_id": s,
        "current_date": START_DATE,
        "start_date": START_DATE,
        "mode": "replay",
        "speed": 1.0,
        "updated_at": now
    })

df = pd.DataFrame(records)

with engine.begin() as conn:
    conn.execute(text("DELETE FROM sim_clock WHERE store_id = ANY(:stores)"), {"stores": STORES})

df.to_sql("sim_clock", engine, if_exists="append", index=False)
print(f"Seeded {len(df)} sim_clock records!")
