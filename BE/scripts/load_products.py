import sys
import os
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

# Giá bán là đầu vào của chi phí A3 (h = 0.002*giá, b = 0.35*giá): thiếu giá thì KHÔNG điền 1.0 giả mà dừng.
PRICES_CSV = os.getenv("M5_PRICES_CSV_PATH") or os.path.join(os.path.dirname(CSV_PATH), "sell_prices.csv")
if not os.path.exists(PRICES_CSV):
    raise SystemExit(
        f"Missing M5 sell_prices.csv (looked at {PRICES_CSV}). Put sell_prices.csv next to "
        "sales_train_evaluation.csv or set M5_PRICES_CSV_PATH. Prices drive all cost figures."
    )
prices_df = pd.read_csv(PRICES_CSV, usecols=["item_id", "sell_price"])
avg_prices = prices_df.groupby("item_id")["sell_price"].mean().round(2).rename("price").reset_index()
df = pd.merge(df, avg_prices, on="item_id", how="left")
missing_price = int(df["price"].isna().sum())
if missing_price:
    print(f"WARNING: {missing_price} items have no price in sell_prices.csv; they keep price NULL.")

existing = pd.read_sql("SELECT item_id FROM products", engine)["item_id"].tolist()
new_df = df[~df["item_id"].isin(existing)]
if len(new_df) > 0:
    new_df.to_sql("products", engine, if_exists="append", index=False)
    print(f"Seeded {len(new_df)} products!")

# Cập nhật giá cho sản phẩm đã có, CHỈ khi giá còn trống hoặc là giá giả của phiên bản cũ (1.0 / <= 0).
# R5B-03: giá admin đã sửa qua /products không bị ghi đè mỗi lần bootstrap. Muốn đặt lại toàn bộ theo M5:
# DFIOS_RESET_PRICES=1.
reset_all = os.getenv("DFIOS_RESET_PRICES", "0") == "1"
price_filter = "" if reset_all else " AND (p.price IS NULL OR p.price <= 0 OR p.price = 1.0)"
known = df.dropna(subset=["price"])[["item_id", "price"]]
with engine.begin() as conn:
    conn.execute(text("CREATE TEMP TABLE _product_prices (item_id TEXT PRIMARY KEY, price DOUBLE PRECISION) ON COMMIT DROP"))
    conn.execute(text("INSERT INTO _product_prices (item_id, price) VALUES (:item_id, :price)"), known.to_dict("records"))
    updated = conn.execute(text(
        "UPDATE products p SET price = t.price FROM _product_prices t "
        "WHERE p.item_id = t.item_id AND p.price IS DISTINCT FROM t.price" + price_filter
    )).rowcount
print(f"Products check complete! prices updated: {updated}"
      + ("" if reset_all else " (only empty / placeholder prices; DFIOS_RESET_PRICES=1 resets all)"))
