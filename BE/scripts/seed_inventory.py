import sys, os
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import pandas as pd
import numpy as np
from app.database import engine

np.random.seed(42)

avg_sales = pd.read_sql(
    "SELECT item_id, store_id, AVG(quantity) as avg_qty FROM sales_history GROUP BY item_id, store_id",
    engine
)

existing = pd.read_sql("SELECT item_id, store_id FROM inventory", engine)
if len(existing) > 0:
    print("Inventory already seeded, nothing to do.")
else:
    avg_sales["on_hand"] = (avg_sales["avg_qty"] * np.random.uniform(5, 20, len(avg_sales))).round(0)
    avg_sales["on_order"] = (avg_sales["avg_qty"] * np.random.uniform(0, 5, len(avg_sales))).round(0)

    final_df = avg_sales[["item_id", "store_id", "on_hand", "on_order"]]
    final_df.to_sql("inventory", engine, if_exists="append", index=False)
    print(f"Seeded {len(final_df)} inventory records!")