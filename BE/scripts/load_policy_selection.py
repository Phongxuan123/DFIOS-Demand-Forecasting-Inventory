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
        CREATE TABLE IF NOT EXISTS policy_selection (
            selection_id VARCHAR(100) NOT NULL,
            class_id VARCHAR(10) NOT NULL,
            policy_type VARCHAR(50) DEFAULT 'REFIT_RSS_EOQ_G',
            m_g DOUBLE PRECISION DEFAULT 0.0,
            kappa_g DOUBLE PRECISION DEFAULT 1.0,
            tau DOUBLE PRECISION DEFAULT 0.95,
            setpoint DOUBLE PRECISION DEFAULT 0.96,
            guard DOUBLE PRECISION DEFAULT 0.01,
            gain_eta DOUBLE PRECISION DEFAULT 1.0,
            val_cost DOUBLE PRECISION,
            val_service DOUBLE PRECISION,
            is_feasible BOOLEAN DEFAULT TRUE,
            econ_service DOUBLE PRECISION DEFAULT 0.95,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            PRIMARY KEY (selection_id, class_id)
        );
    """))

SELECTION_ID = "quarter_2015_Q2"
now = datetime.now(timezone.utc)

OPTIMAL_POLICIES = [
    {"class_id": "AX", "m_g": 0.0, "kappa_g": 1.0, "val_cost": 319489.84, "val_service": 0.9495},
    {"class_id": "AY", "m_g": 0.0, "kappa_g": 1.0, "val_cost": 395968.80, "val_service": 0.9494},
    {"class_id": "AZ", "m_g": 0.0, "kappa_g": 1.0, "val_cost": 66254.19,  "val_service": 0.9490},
    {"class_id": "BX", "m_g": 0.0, "kappa_g": 1.0, "val_cost": 64478.95,  "val_service": 0.9499},
    {"class_id": "BY", "m_g": 0.0, "kappa_g": 1.0, "val_cost": 421200.50, "val_service": 0.9491},
    {"class_id": "BZ", "m_g": 0.0, "kappa_g": 1.0, "val_cost": 156711.20, "val_service": 0.9489},
    {"class_id": "CX", "m_g": 0.0, "kappa_g": 1.0, "val_cost": 2907.45,   "val_service": 0.9483},
    {"class_id": "CY", "m_g": 0.0, "kappa_g": 1.0, "val_cost": 176043.10, "val_service": 0.9492},
    {"class_id": "CZ", "m_g": 0.0, "kappa_g": 1.0, "val_cost": 491428.00, "val_service": 0.9479},
]

records = []
for p in OPTIMAL_POLICIES:
    records.append({
        "selection_id": SELECTION_ID,
        "class_id": p["class_id"],
        "policy_type": "REFIT_RSS_EOQ_G",
        "m_g": p["m_g"],
        "kappa_g": p["kappa_g"],
        "tau": 0.95,
        "setpoint": 0.96,
        "guard": 0.01,
        "gain_eta": 1.0,
        "val_cost": p["val_cost"],
        "val_service": p["val_service"],
        "is_feasible": True,
        "econ_service": 0.95,
        "created_at": now
    })

df = pd.DataFrame(records)

with engine.begin() as conn:
    conn.execute(text("DELETE FROM policy_selection WHERE selection_id = :sid"), {"sid": SELECTION_ID})

df.to_sql("policy_selection", engine, if_exists="append", index=False)
print(f"Seeded {len(df)} policy_selection records for {SELECTION_ID} (REFIT_RSS_EOQ_G)!")
