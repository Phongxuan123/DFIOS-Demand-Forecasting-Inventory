import sys
import os
import uuid
import json
from datetime import datetime, timezone, date, timedelta

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

from app.core.database import SessionLocal, engine
from app.core.db_bulk import psql_insert_copy
from app.services.window_quantile_service import window_quantile_service, ROUTE_C_TAU_LEVELS
import numpy as np
from datetime import timedelta

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
        origin_dt = datetime.strptime(ORIGIN_DATE, "%Y-%m-%d").date()
        existing_ids = set(pd.read_sql(f"""
            SELECT id FROM forecast_window_quantile 
            WHERE store_id = '{STORE_ID}' 
              AND model_run_id = '{MODEL_RUN_ID}' 
              AND origin_date = '{ORIGIN_DATE}' 
              AND horizon_days = {HORIZON_DAYS}
        """, engine)["id"])

        missing_skus = [sku for sku in skus_df["item_id"] if f"{MODEL_RUN_ID}_{STORE_ID}_{sku}_{origin_dt}_{HORIZON_DAYS}" not in existing_ids]

        if not missing_skus:
            print(f"Quantiles for {STORE_ID} already seeded ({len(existing_ids)} records), skipping.", flush=True)
        else:
            print(f"Bắt đầu nạp quantile Route (c) thực nghiệm chuẩn tắc cho {len(missing_skus)} SKU còn thiếu ({STORE_ID})...", flush=True)
            m5_start = date(2011, 1, 29)
            cutoff_date = origin_dt - timedelta(days=HORIZON_DAYS)
            cutoff_day_idx = (cutoff_date - m5_start).days + 1

            # Tối ưu Bulk Prefetch: Đọc trước dữ liệu dự báo, backtest và bán hàng một lần duy nhất
            print("  -> Bulk prefetching forecast, backtest và sales...", flush=True)
            df_fc = pd.read_sql(f"""
                SELECT item_id, forecast_date, h, y_pred 
                FROM forecast 
                WHERE store_id = '{STORE_ID}' 
                  AND h BETWEEN 1 AND {HORIZON_DAYS}
                  AND forecast_date >= '{ORIGIN_DATE}'
                  AND (model_version != 'fast-inference-sba' OR model_version IS NULL)
            """, engine)

            df_ov = pd.read_sql(f"""
                SELECT item_id, forecast_date, h, override_value 
                FROM forecast_overrides 
                WHERE store_id = '{STORE_ID}' AND is_active = True
            """, engine)

            df_bt = pd.read_sql(f"""
                SELECT item_id, review_day, dhat 
                FROM forecast_backtest 
                WHERE store_id = '{STORE_ID}'
                  AND review_day + {HORIZON_DAYS} <= {cutoff_day_idx + HORIZON_DAYS}
            """, engine)

            df_sales = pd.read_sql(f"""
                SELECT item_id, sale_date, quantity 
                FROM sales_history 
                WHERE store_id = '{STORE_ID}' 
                  AND sale_date >= '2015-01-01'
            """, engine)

            # Lập chỉ mục tra cứu tốc độ cao O(1)
            fc_grouped = {item_id: grp.sort_values("h") for item_id, grp in df_fc.groupby("item_id")}
            ov_dict = {}
            for _, r in df_ov.iterrows():
                ov_dict[(r["item_id"], r["forecast_date"])] = float(r["override_value"])
                if pd.notna(r["h"]):
                    ov_dict[(r["item_id"], r["forecast_date"], int(r["h"]))] = float(r["override_value"])

            bt_grouped = {item_id: grp.sort_values("review_day", ascending=False).head(52) for item_id, grp in df_bt.groupby("item_id")}
            sales_dict = {}
            for _, r in df_sales.iterrows():
                sales_dict[(r["item_id"], r["sale_date"])] = float(r["quantity"])

            new_records = []
            for i, sku in enumerate(missing_skus, start=1):
                # 1. Point window
                if sku in fc_grouped:
                    grp = fc_grouped[sku].head(HORIZON_DAYS)
                    p_val = sum(
                        ov_dict.get((sku, r["forecast_date"], int(r["h"])),
                        ov_dict.get((sku, r["forecast_date"]), float(r["y_pred"])))
                        for _, r in grp.iterrows()
                    )
                    point_window = float(round(p_val, 2))
                else:
                    point_window = 10.0

                # 2. Residuals từ backtest
                residuals = np.array([])
                if sku in bt_grouped:
                    bt_rows = bt_grouped[sku]
                    if len(bt_rows) >= 5:
                        res_list = []
                        for _, br in bt_rows.iterrows():
                            rev_day = int(br["review_day"])
                            dhat = float(br["dhat"])
                            cycle_start = m5_start + timedelta(days=rev_day - 1)
                            actual_qty = sum(
                                sales_dict.get((sku, cycle_start + timedelta(days=d)), 0.0)
                                for d in range(HORIZON_DAYS)
                            )
                            res_list.append(actual_qty - dhat * HORIZON_DAYS)
                        if len(res_list) >= 5:
                            residuals = np.array(res_list)

                # 3. Tính phân phối quantile
                q_dict = window_quantile_service.calculate_quantiles_dict(point_window, residuals)
                rec_id = f"{MODEL_RUN_ID}_{STORE_ID}_{sku}_{origin_dt}_{HORIZON_DAYS}"

                new_records.append({
                    "id": rec_id,
                    "model_run_id": MODEL_RUN_ID,
                    "store_id": STORE_ID,
                    "item_id": sku,
                    "origin_date": origin_dt,
                    "horizon_days": HORIZON_DAYS,
                    "point_window": point_window,
                    "q_levels": json.dumps(q_dict),
                    "route": "c",
                    "created_at": now,
                })

                if i % 500 == 0 or i == len(missing_skus):
                    print(f"  -> Đã tính toán {i}/{len(missing_skus)} SKU...", flush=True)

            if new_records:
                print(f"  -> Đang bulk insert {len(new_records)} bản ghi bằng psql_insert_copy...", flush=True)
                df_to_seed = pd.DataFrame(new_records)
                df_to_seed.to_sql("forecast_window_quantile", engine, if_exists="append", index=False, method=psql_insert_copy)
                print(f"Hoàn tất nạp {len(new_records)} bản ghi Route (c) thực nghiệm nhân quả cho {STORE_ID} qua bulk COPY!", flush=True)
    else:
        print("No items found to seed forecast_window_quantile.")
finally:
    db.close()
