import sys
import os
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import pandas as pd
from sqlalchemy import text
from app.core.database import engine

STORE_ID = "CA_1"
START_DATE = "2015-05-24"
now = datetime.now(timezone.utc)

with engine.begin() as conn:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS inventory_daily (
            store_id VARCHAR(50) NOT NULL,
            item_id VARCHAR(100) NOT NULL,
            date DATE NOT NULL,
            on_hand_end DOUBLE PRECISION DEFAULT 0.0,
            on_order DOUBLE PRECISION DEFAULT 0.0,
            sales DOUBLE PRECISION DEFAULT 0.0,
            lost_sales DOUBLE PRECISION DEFAULT 0.0,
            stockout BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            PRIMARY KEY (store_id, item_id, date)
        );
        ALTER TABLE inventory_daily ALTER COLUMN created_at SET DEFAULT NOW();
    """))

inv_df = pd.read_sql(f"SELECT store_id, item_id, on_hand, on_order FROM inventory WHERE store_id = '{STORE_ID}'", engine)

if not inv_df.empty:
    daily_df = inv_df.copy()
    daily_df["date"] = pd.to_datetime(START_DATE).date()
    daily_df["on_hand_end"] = daily_df["on_hand"].fillna(0.0)
    daily_df["on_order"] = daily_df["on_order"].fillna(0.0)
    daily_df["sales"] = 0.0
    daily_df["lost_sales"] = 0.0
    daily_df["stockout"] = daily_df["on_hand_end"] <= 0.0
    daily_df["created_at"] = now

    insert_df = daily_df[["store_id", "item_id", "date", "on_hand_end", "on_order", "sales", "lost_sales", "stockout", "created_at"]]

    with engine.begin() as conn:
        conn.execute(text("DELETE FROM inventory_daily WHERE store_id = :s AND date = :d"), {"s": STORE_ID, "d": START_DATE})

    insert_df.to_sql("inventory_daily", engine, if_exists="append", index=False, chunksize=1000, method="multi")
    print(f"Seeded {len(insert_df)} inventory_daily initial records for {STORE_ID} on {START_DATE}!")
else:
    print(f"No inventory found for {STORE_ID} to seed inventory_daily.")
