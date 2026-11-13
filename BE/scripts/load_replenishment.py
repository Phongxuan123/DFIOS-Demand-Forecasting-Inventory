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

with engine.begin() as conn:
    conn.execute(text("""
        ALTER TABLE replenishment_recommendations
            ADD COLUMN IF NOT EXISTS "order_up_to_S" DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS reorder_point_s DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS inventory_position DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS eoq_quantity DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS policy_applied VARCHAR(50) DEFAULT 'REFIT-RSS-EOQ-G',
            ADD COLUMN IF NOT EXISTS review_date DATE;
    """))

inv_df = pd.read_sql(f"SELECT item_id, on_hand, on_order FROM inventory WHERE store_id = '{STORE_ID}'", engine)
params_df = pd.read_sql(f"SELECT item_id, safety_stock, reorder_point, eoq, s, \"S\" FROM inventory_params WHERE store_id = '{STORE_ID}'", engine)

joined = pd.merge(inv_df, params_df, on="item_id", how="inner")

joined["inventory_position"] = joined["on_hand"] + joined["on_order"]
joined["reorder_point_s"] = joined["s"].fillna(joined["reorder_point"])
joined["order_up_to_S"] = joined["S"].fillna(joined["reorder_point_s"] + joined["eoq"])

reorder_items = joined[joined["inventory_position"] <= joined["reorder_point_s"]].copy()

recs = []
for _, row in reorder_items.iterrows():
    priority = "CRITICAL" if row["on_hand"] <= row["safety_stock"] else "HIGH"
    order_qty = max(float(row["eoq"]), float(row["order_up_to_S"] - row["inventory_position"]))
    order_qty = round(order_qty, 2)

    recs.append({
        "id": str(uuid.uuid4()),
        "item_id": row["item_id"],
        "store_id": STORE_ID,
        "supplier_id": None,
        "recommended_qty": order_qty,
        "final_qty": order_qty,
        "priority": priority,
        "status": "PENDING",
        "reason": "REFIT-RSS-EOQ-G trigger: Inventory position below reorder point (s)",
        "order_up_to_S": round(float(row["order_up_to_S"]), 2),
        "reorder_point_s": round(float(row["reorder_point_s"]), 2),
        "inventory_position": round(float(row["inventory_position"]), 2),
        "eoq_quantity": round(float(row["eoq"]), 2),
        "policy_applied": "REFIT-RSS-EOQ-G",
        "review_date": now.date(),
        "created_at": now,
        "decided_at": None,
        "decided_by": None
    })

if recs:
    recs_df = pd.DataFrame(recs)
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM replenishment_recommendations WHERE store_id = :s AND status IN ('PENDING', 'PROPOSED')"), {"s": STORE_ID})
    recs_df.to_sql("replenishment_recommendations", engine, if_exists="append", index=False, chunksize=1000, method="multi")
    print(f"Seeded {len(recs_df)} replenishment recommendations!")
else:
    print("No replenishment recommendations needed.")
