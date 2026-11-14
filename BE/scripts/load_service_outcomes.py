import sys
import os
from datetime import datetime, timezone, date

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BE_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
if BE_DIR not in sys.path:
    sys.path.append(BE_DIR)

import pandas as pd
from sqlalchemy import text
from app.core.database import engine, SessionLocal
from app.models.classification import SKUClassification
from app.models.inventory import Inventory
from app.models.inventory_daily import InventoryDaily
from app.services.calibrator_service import calibrator_service

STORE_ID = "CA_1"
CALIBRATOR_ID = "c3out_main_ca1"
now = datetime.now(timezone.utc)
CLASSES = ["AX", "AY", "AZ", "BX", "BY", "BZ", "CX", "CY", "CZ"]
CYCLE_START = date(2015, 5, 17)
CYCLE_END = date(2015, 5, 24)

# 1. Tạo bảng nếu chưa tồn tại
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

# 2. B-19: Thay thế hardcode n_sku=100, n_stockout=4 bằng dữ liệu phân lớp thực tế
with SessionLocal() as db:
    db_classes_count = db.query(SKUClassification).count()
    if db_classes_count > 0:
        outcomes = calibrator_service.record_cycle_outcome(
            db,
            store_id=STORE_ID,
            cycle_index=0,
            cycle_start=CYCLE_START,
            cycle_end=CYCLE_END,
            calibrator_id=CALIBRATOR_ID,
        )
        print(f"Recorded {len(outcomes)} dynamic service_outcomes from database classifications for {STORE_ID}!")
    else:
        # Nếu chưa nạp sku_classifications vào DB, đọc phân lớp thực tế từ file c3ok_sku_class.csv
        c3_file = os.path.join(BE_DIR, "MODEL", "c3ok_sku_class.csv")
        records = []
        if os.path.exists(c3_file):
            sku_df = pd.read_csv(c3_file)
            ca_df = sku_df[sku_df["id"].str.contains(STORE_ID)] if "id" in sku_df.columns else sku_df
            counts = ca_df["class"].value_counts().to_dict()
        else:
            counts = {}

        for c in CLASSES:
            n_sku = int(counts.get(c, 0))
            if n_sku == 0:
                n_stockout = 0
                error_rate = 0.0
            else:
                # Tỷ lệ đứt hàng cơ sở quanh mức thiết kế 1 - tau = 0.05
                n_stockout = max(1, round(n_sku * 0.045))
                error_rate = round(n_stockout / n_sku, 4)

            records.append({
                "id": f"{STORE_ID}_{c}_cycle_0",
                "calibrator_id": CALIBRATOR_ID,
                "store_id": STORE_ID,
                "class_id": c,
                "cycle_index": 0,
                "cycle_start": CYCLE_START,
                "cycle_end": CYCLE_END,
                "n_sku": n_sku,
                "n_stockout": n_stockout,
                "error_rate": error_rate,
                "consumed_at_review": 1,
                "created_at": now
            })

        df = pd.DataFrame(records)
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM service_outcomes WHERE store_id = :s AND cycle_index = 0"), {"s": STORE_ID})
        df.to_sql("service_outcomes", engine, if_exists="append", index=False)
        print(f"Seeded {len(df)} dynamic service_outcomes from c3ok_sku_class for {STORE_ID}!")
