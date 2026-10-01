import sys, os
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import pandas as pd
from app.database import engine

CSV_PATH = r"C:\m5-forecasting-accuracy\sales_train_evaluation.csv"

df = pd.read_csv(CSV_PATH, usecols=["item_id", "dept_id", "cat_id"])
df = df.drop_duplicates(subset="item_id").reset_index(drop=True)
df["name"] = df["item_id"]  # M5 gốc không có tên mô tả, tạm dùng mã SKU

df.to_sql("products", engine, if_exists="append", index=False)
print(f"Seeded {len(df)} products!")