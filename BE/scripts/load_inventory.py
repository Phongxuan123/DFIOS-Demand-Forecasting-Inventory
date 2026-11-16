import sys
import os
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import pandas as pd
from app.core.database import engine
from app.services import policy_config as pc

# R-09: policy-consistent initial stock. Every SKU starts at its order-up-to level S of inventory_params
# (load_inventory_params runs before this step); SKUs without a parameter row start at mean daily demand x H
# (H = L + R = 10, policy_config). sync_scientific_baseline (last bootstrap step) recomputes the parameters once
# more and resets the stock to the FINAL S (simulator_service.initialise_baseline), so the two always agree.
existing = pd.read_sql("SELECT item_id, store_id FROM inventory", engine)
if len(existing) > 0:
    print("Inventory already seeded, nothing to do.")
else:
    avg_sales = pd.read_sql(
        "SELECT item_id, store_id, AVG(quantity) as avg_qty FROM sales_history GROUP BY item_id, store_id",
        engine,
    )
    params = pd.read_sql('SELECT item_id, store_id, "S" AS s_up FROM inventory_params', engine)
    df = avg_sales.merge(params, on=["item_id", "store_id"], how="left")
    from_s = df["s_up"].notna()
    df["on_hand"] = df["s_up"].where(from_s, (df["avg_qty"] * pc.HORIZON_DAYS).round(0)).clip(lower=0).apply(
        lambda v: float(-(-v // 1)))  # ceil
    df["on_order"] = 0.0
    final_df = df[["item_id", "store_id", "on_hand", "on_order"]]
    final_df.to_sql("inventory", engine, if_exists="append", index=False)
    print(f"Seeded {len(final_df)} inventory records ({int(from_s.sum())} at S of inventory_params, "
          f"{int((~from_s).sum())} at mean demand x H={pc.HORIZON_DAYS})!")
