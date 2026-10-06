import sys, os
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import pandas as pd
from dotenv import load_dotenv
from app.core.database import engine

load_dotenv(os.path.join(SCRIPT_DIR, "..", ".env"))
CSV_PATH = os.getenv("M5_SALES_CSV_PATH")

N_DAYS = 913  # ~2.5 years

df = pd.read_csv(CSV_PATH)
all_day_cols = [c for c in df.columns if c.startswith("d_")]
day_cols = all_day_cols[-N_DAYS:]

long_df = df.melt(
    id_vars=["item_id", "store_id"],
    value_vars=day_cols,
    var_name="day",
    value_name="quantity"
)

start_date = pd.Timestamp("2011-01-29")
long_df["day_num"] = long_df["day"].str.replace("d_", "").astype(int)
long_df["sale_date"] = start_date + pd.to_timedelta(long_df["day_num"] - 1, unit="D")
long_df["id"] = long_df["item_id"] + "_" + long_df["store_id"]

final_df = long_df[["id", "item_id", "store_id", "sale_date", "quantity"]]

print(f"Total {len(final_df)} rows, starting import...")
final_df.to_sql("sales_history", engine, if_exists="append", index=False,
                 chunksize=50_000, method="multi")
print("Done!")