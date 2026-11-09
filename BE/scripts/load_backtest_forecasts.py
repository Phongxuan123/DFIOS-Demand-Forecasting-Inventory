import sys
import os
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import numpy as np
import pandas as pd
from sqlalchemy import text
from app.core.database import engine

NPZ_PATH = os.path.join(SCRIPT_DIR, "..", "MODEL", "c3ok_forecasts.npz")
if not os.path.exists(NPZ_PATH):
    raise SystemExit(f"Missing backtest forecasts file at {NPZ_PATH}")

print("Loading backtest forecasts from NPZ file...")
data = np.load(NPZ_PATH)

DHAT = data["DHAT"]          # shape: (72, 30490)
DHAT_LGB = data["DHAT_LGB"]  # shape: (72, 30490)
SIGMA_D = data["SIGMA_D"]    # shape: (30490,)
REVIEWS = data["REVIEWS"]    # shape: (72,)
IDS = data["ids"]            # shape: (30490,)

# Tạo bảng lưu trữ dự báo backtest nhân quả
with engine.begin() as conn:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS forecast_backtest (
            id VARCHAR(100) PRIMARY KEY,
            store_id VARCHAR(50) NOT NULL,
            item_id VARCHAR(100) NOT NULL,
            review_day INTEGER NOT NULL,
            dhat DOUBLE PRECISION NOT NULL,
            dhat_lgb DOUBLE PRECISION NOT NULL,
            sigma_d DOUBLE PRECISION NOT NULL,
            model_run VARCHAR(50) DEFAULT 'backtest-ensemble-v1',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_fc_backtest_lookup 
            ON forecast_backtest (store_id, item_id, review_day);
    """))

# Trích xuất dữ liệu cho cửa hàng thử nghiệm CA_1
print("Extracting causal forecasts for CA_1...")
ca1_indices = [i for i, s in enumerate(IDS) if "_CA_1_" in s]
print(f"Found {len(ca1_indices)} series for CA_1.")

records = []
now = datetime.now(timezone.utc)

for idx in ca1_indices:
    series_id = str(IDS[idx])
    # Tách item_id: HOBBIES_1_001_CA_1_evaluation -> HOBBIES_1_001
    parts = series_id.split("_CA_1_")
    item_id = parts[0]
    store_id = "CA_1"
    sigma = float(SIGMA_D[idx])

    for r_idx, rev in enumerate(REVIEWS):
        dhat_val = round(float(DHAT[r_idx, idx]), 3)
        dhat_lgb_val = round(float(DHAT_LGB[r_idx, idx]), 3)
        rec_id = f"{item_id}_{store_id}_rev{rev}"

        records.append({
            "id": rec_id,
            "store_id": store_id,
            "item_id": item_id,
            "review_day": int(rev),
            "dhat": dhat_val,
            "dhat_lgb": dhat_lgb_val,
            "sigma_d": sigma,
            "model_run": "backtest-ensemble-v1",
            "created_at": now,
        })

df_backtest = pd.DataFrame(records)
print(f"Total backtest forecast records prepared: {len(df_backtest)}")

# Nạp vào database theo chunks
with engine.begin() as conn:
    conn.execute(text("DELETE FROM forecast_backtest WHERE store_id = 'CA_1'"))

df_backtest.to_sql("forecast_backtest", engine, if_exists="append", index=False, chunksize=10000, method="multi")
print(f"Successfully loaded {len(df_backtest)} causal backtest forecasts into forecast_backtest!")

