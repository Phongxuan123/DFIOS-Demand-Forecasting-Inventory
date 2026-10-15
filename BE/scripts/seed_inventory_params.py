import sys
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import pandas as pd
import numpy as np
from datetime import datetime, timezone
from sqlalchemy import text
from app.core.database import engine

STORE_ID = "CA_1"
LEAD_TIME = 7
TAU = 0.95
Z_TAU = 1.645
HOLDING_COST = 2.0
ORDER_COST = 50.0

forecast_path = os.path.join(SCRIPT_DIR, "production_forecast.parquet")
sigma_path = os.path.join(SCRIPT_DIR, "production_sigma.parquet")

fc_df = pd.read_parquet(forecast_path)
fc_df = fc_df[(fc_df["store_id"] == STORE_ID) & (fc_df["h"] <= LEAD_TIME)]

sg_df = pd.read_parquet(sigma_path)
sg_df["item_id"] = sg_df["id"].apply(lambda x: "_".join(x.split("_")[:3]))
sg_store = sg_df[sg_df["id"].str.contains(f"_{STORE_ID}_")].copy()

dl_df = fc_df.groupby("item_id")["y_pred"].sum().reset_index()
dl_df.rename(columns={"y_pred": "d_l"}, inplace=True)

merged = pd.merge(dl_df, sg_store[["item_id", "sigma_d_h7"]], on="item_id", how="left")
merged["sigma_d_h7"] = merged["sigma_d_h7"].fillna(1.5)

merged["safety_stock"] = (Z_TAU * merged["sigma_d_h7"]).round(2).clip(lower=0.0)
merged["reorder_point"] = (merged["d_l"] + merged["safety_stock"]).round(2).clip(lower=0.0)
merged["annual_demand"] = ((merged["d_l"] / LEAD_TIME) * 365).round(2).clip(lower=1.0)
merged["eoq"] = np.sqrt((2 * merged["annual_demand"] * ORDER_COST) / HOLDING_COST).round(2).clip(lower=1.0)

now = datetime.now(timezone.utc)
merged["id"] = STORE_ID + "_" + merged["item_id"]
merged["store_id"] = STORE_ID
merged["service_level"] = TAU
merged["lead_time_days"] = LEAD_TIME
merged["holding_cost"] = HOLDING_COST
merged["order_cost"] = ORDER_COST
merged["unit_price"] = 10.0
merged["source"] = "ml"
merged["updated_at"] = now

final_params = merged[[
    "id", "item_id", "store_id", "service_level", "lead_time_days",
    "safety_stock", "reorder_point", "eoq", "annual_demand",
    "holding_cost", "order_cost", "unit_price", "source", "updated_at"
]]

with engine.begin() as conn:
    conn.execute(text("DELETE FROM inventory_params WHERE store_id = :s"), {"s": STORE_ID})

final_params.to_sql("inventory_params", engine, if_exists="append", index=False, chunksize=1000, method="multi")
print(f"Seeded {len(final_params)} inventory_params records!")
