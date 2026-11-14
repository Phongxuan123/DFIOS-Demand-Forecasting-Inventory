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
        # B-19: no classification -> there is no observed stock-out data either. Nothing is invented
        # (no n_sku=100 / 4.5 % fallback): service_outcomes are produced only by the simulator (J6) or from
        # real inventory_daily rows. Load sku_classifications first (scripts/load_classification or /classification).
        print(
            "SKIP: sku_classifications is empty - service_outcomes NOT written "
            "(no fabricated fallback). Run the classification loader, then re-run this script."
        )
