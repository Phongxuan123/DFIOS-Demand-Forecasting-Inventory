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
ORIGIN_DATE = "2016-05-23"
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

from app.core.database import SessionLocal
from app.services.window_quantile_service import window_quantile_service, ROUTE_C_TAU_LEVELS

db = SessionLocal()
try:
    # Lấy danh sách SKU từ cửa hàng STORE_ID
    skus_df = pd.read_sql(f"""
        SELECT DISTINCT item_id 
        FROM inventory 
        WHERE store_id = '{STORE_ID}'
        ORDER BY item_id
    """, engine)

    if not skus_df.empty:
        print(f"Bắt đầu nạp quantile Route (c) thực nghiệm chuẩn tắc cho {len(skus_df)} SKU ({STORE_ID})...")
        seeded_count = 0
        origin_dt = datetime.strptime(ORIGIN_DATE, "%Y-%m-%d").date()

        for idx, row in skus_df.iterrows():
            sku = row["item_id"]
            window_quantile_service.get_or_create_window_quantile(
                db,
                store_id=STORE_ID,
                item_id=sku,
                origin_date=origin_dt,
                horizon_days=HORIZON_DAYS,
                model_run_id=MODEL_RUN_ID,
            )
            seeded_count += 1
            if seeded_count % 500 == 0:
                print(f"  -> Đã nạp {seeded_count}/{len(skus_df)} SKU...")

        print(f"Hoàn tất nạp {seeded_count} bản ghi Route (c) thực nghiệm nhân quả cho {STORE_ID}!")
    else:
        print("No items found to seed forecast_window_quantile.")
finally:
    db.close()
