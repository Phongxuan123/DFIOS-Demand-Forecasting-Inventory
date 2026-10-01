import sys, os
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import pandas as pd
from dotenv import load_dotenv
from app.database import engine

load_dotenv(os.path.join(SCRIPT_DIR, "..", ".env"))

CSV_PATH = os.getenv("M5_SALES_CSV_PATH")
if not CSV_PATH:
    raise SystemExit("Thiếu M5_SALES_CSV_PATH trong file .env — xem BE/.env.example")

df = pd.read_csv(CSV_PATH, usecols=["item_id", "dept_id", "cat_id"])
df = df.drop_duplicates(subset="item_id").reset_index(drop=True)
df["name"] = df["item_id"]

existing = pd.read_sql("SELECT item_id FROM products", engine)["item_id"].tolist()
df = df[~df["item_id"].isin(existing)]

if len(df) == 0:
    print("Products already seeded, nothing to do.")
else:
    df.to_sql("products", engine, if_exists="append", index=False)
    print(f"Seeded {len(df)} products!")