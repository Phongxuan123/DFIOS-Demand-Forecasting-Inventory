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
    {"class_id": "AX", "m_g": 0.0, "kappa_g": 1.0, "val_cost": 12500.0, "val_service": 0.968},
    {"class_id": "AY", "m_g": 0.0, "kappa_g": 1.0, "val_cost": 15400.0, "val_service": 0.962},
    {"class_id": "AZ", "m_g": 0.0, "kappa_g": 1.0, "val_cost": 18200.0, "val_service": 0.961},
    {"class_id": "BX", "m_g": 0.0, "kappa_g": 1.0, "val_cost": 8900.0,  "val_service": 0.967},
    {"class_id": "BY", "m_g": 0.0, "kappa_g": 1.0, "val_cost": 11300.0, "val_service": 0.963},
    {"class_id": "BZ", "m_g": 0.0, "kappa_g": 1.0, "val_cost": 14100.0, "val_service": 0.960},
    {"class_id": "CX", "m_g": 0.0, "kappa_g": 1.0, "val_cost": 3200.0,  "val_service": 0.965},
    {"class_id": "CY", "m_g": 0.0, "kappa_g": 1.0, "val_cost": 5400.0,  "val_service": 0.964},
    {"class_id": "CZ", "m_g": 0.0, "kappa_g": 1.0, "val_cost": 9100.0,  "val_service": 0.961},
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
