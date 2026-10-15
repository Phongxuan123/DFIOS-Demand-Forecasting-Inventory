import sys
import os
import uuid

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import pandas as pd
from datetime import datetime, timezone
from sqlalchemy import text
from app.core.database import engine

STORE_ID = "CA_1"
now = datetime.now(timezone.utc)

inv_df = pd.read_sql(f"SELECT item_id, on_hand, on_order FROM inventory WHERE store_id = '{STORE_ID}'", engine)
params_df = pd.read_sql(f"SELECT item_id, safety_stock, reorder_point, eoq FROM inventory_params WHERE store_id = '{STORE_ID}'", engine)

joined = pd.merge(inv_df, params_df, on="item_id", how="inner")
reorder_items = joined[(joined["on_hand"] + joined["on_order"]) <= joined["reorder_point"]].copy()

recs = []
for _, row in reorder_items.iterrows():
    priority = "CRITICAL" if row["on_hand"] <= row["safety_stock"] else "HIGH"
    recs.append({
        "id": str(uuid.uuid4()),
        "item_id": row["item_id"],
        "store_id": STORE_ID,
        "supplier_id": None,
        "recommended_qty": row["eoq"],
        "final_qty": row["eoq"],
        "priority": priority,
        "status": "PENDING",
        "reason": "On-hand stock at or below reorder point (ROP)",
        "created_at": now,
        "decided_at": None,
        "decided_by": None
    })

if recs:
    recs_df = pd.DataFrame(recs)
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM replenishment_recommendations WHERE store_id = :s AND status = 'PENDING'"), {"s": STORE_ID})
    recs_df.to_sql("replenishment_recommendations", engine, if_exists="append", index=False, chunksize=1000, method="multi")
    print(f"Seeded {len(recs_df)} replenishment recommendations!")
else:
    print("No replenishment recommendations needed.")
