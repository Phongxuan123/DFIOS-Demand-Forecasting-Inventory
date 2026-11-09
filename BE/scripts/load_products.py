import sys, os
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import text
from app.core.database import engine

load_dotenv(os.path.join(SCRIPT_DIR, "..", ".env"))

with engine.begin() as conn:
    conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS price DOUBLE PRECISION DEFAULT 1.0;"))

CSV_PATH = os.getenv("M5_SALES_CSV_PATH")
if not CSV_PATH:
    raise SystemExit("Missing M5_SALES_CSV_PATH in .env file - see BE/.env.example")

df = pd.read_csv(CSV_PATH, usecols=["item_id", "dept_id", "cat_id"])
df = df.drop_duplicates(subset="item_id").reset_index(drop=True)
df["name"] = df["item_id"]

PRICES_CSV = os.path.join(os.path.dirname(CSV_PATH), "sell_prices.csv")
if os.path.exists(PRICES_CSV):
    try:
        prices_df = pd.read_csv(PRICES_CSV, usecols=["item_id", "sell_price"])
        avg_prices = prices_df.groupby("item_id")["sell_price"].mean().reset_index()
        df = pd.merge(df, avg_prices, on="item_id", how="left")
        df.rename(columns={"sell_price": "price"}, inplace=True)
        df["price"] = df["price"].fillna(1.0).round(2)
    except Exception:
        df["price"] = 1.0
else:
    df["price"] = 1.0

existing = pd.read_sql("SELECT item_id FROM products", engine)["item_id"].tolist()
new_df = df[~df["item_id"].isin(existing)]

if len(new_df) > 0:
    new_df.to_sql("products", engine, if_exists="append", index=False)
    print(f"Seeded {len(new_df)} products!")
else:
    with engine.begin() as conn:
        conn.execute(text("UPDATE products SET price = 1.0 WHERE price IS NULL;"))
    print("Products check complete!")
