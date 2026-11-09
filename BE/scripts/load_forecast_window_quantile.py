import sys
import os
import uuid
import json
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import pandas as pd
from sqlalchemy import text
from app.core.database import engine

STORE_ID = "CA_1"
ORIGIN_DATE = "2015-05-24"
HORIZON_DAYS = 10
MODEL_RUN_ID = "backtest-ensemble-v1"
now = datetime.now(timezone.utc)

with engine.begin() as conn:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS forecast_window_quantile (
            id VARCHAR(100) PRIMARY KEY,
            model_run_id VARCHAR(100) NOT NULL,
            store_id VARCHAR(50) NOT NULL,
            item_id VARCHAR(100) NOT NULL,
            origin_date DATE NOT NULL,
            horizon_days INTEGER NOT NULL DEFAULT 10,
            point_window DOUBLE PRECISION NOT NULL,
            q_levels JSONB NOT NULL,
            route VARCHAR(10) DEFAULT 'c',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        ALTER TABLE forecast_window_quantile ALTER COLUMN created_at SET DEFAULT NOW();
        CREATE INDEX IF NOT EXISTS idx_fwq_lookup ON forecast_window_quantile (model_run_id, store_id, item_id, origin_date);
    """))

items_df = pd.read_sql(f"""
    SELECT p.item_id, COALESCE(ip.reorder_point, 5.0) as r_point, COALESCE(ip.safety_stock, 2.0) as ss
    FROM products p
    LEFT JOIN inventory_params ip ON p.item_id = ip.item_id AND ip.store_id = '{STORE_ID}'
    LIMIT 500
""", engine)

if not items_df.empty:
    records = []
    TAU_LEVELS = [0.80, 0.85, 0.90, 0.93, 0.95, 0.96, 0.97, 0.975, 0.98, 0.985, 0.99, 0.995, 0.999]

    for _, row in items_df.iterrows():
        pw = round(float(row["r_point"]), 2)
        ss = float(row["ss"])
        q_dict = {}
        for tau in TAU_LEVELS:
            mult = 1.0 + (tau - 0.90) * 1.5
            q_val = max(1.0, round(pw + ss * mult, 2))
            q_dict[str(tau)] = q_val

        records.append({
            "id": f"{STORE_ID}_{row['item_id']}_{ORIGIN_DATE}_{HORIZON_DAYS}",
            "model_run_id": MODEL_RUN_ID,
            "store_id": STORE_ID,
            "item_id": row["item_id"],
            "origin_date": ORIGIN_DATE,
            "horizon_days": HORIZON_DAYS,
            "point_window": pw,
            "q_levels": json.dumps(q_dict),
            "route": "c",
            "created_at": now
        })

    df = pd.DataFrame(records)
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM forecast_window_quantile WHERE store_id = :s AND origin_date = :d"), {"s": STORE_ID, "d": ORIGIN_DATE})
    df.to_sql("forecast_window_quantile", engine, if_exists="append", index=False, chunksize=1000, method="multi")
    print(f"Seeded {len(df)} forecast_window_quantile records (Route c, H={HORIZON_DAYS}) for {STORE_ID}!")
else:
    print("No items found to seed forecast_window_quantile.")
