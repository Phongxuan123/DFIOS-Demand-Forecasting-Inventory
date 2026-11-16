import sys
import os
import uuid

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import pandas as pd
from datetime import datetime, timezone
from sqlalchemy import text
from app.core.database import engine
from app.core.db_bulk import replace_rows
from app.services.policy_config import DEMO_START_DATE

STORE_ID = "CA_1"
now = datetime.now(timezone.utc)

# P-12: proposals are dated with the SIMULATED clock of the store (never wall-clock "today"/NULL), so they sit in
# the same time axis as the simulator. They stay PENDING proposals: the simulator only receives APPROVED orders,
# and in auto-order mode PENDING rows never block reordering (replenishment_service.generate_recommendations).
with engine.begin() as _conn:
    _row = _conn.execute(text('SELECT "current_date" FROM sim_clock WHERE store_id = :s'), {"s": STORE_ID}).first()
REVIEW_DATE = _row[0] if _row else DEMO_START_DATE

with engine.begin() as conn:
    conn.execute(text("""
        ALTER TABLE replenishment_recommendations
            ADD COLUMN IF NOT EXISTS "order_up_to_S" DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS reorder_point_s DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS inventory_position DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS eoq_quantity DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS policy_applied VARCHAR(50) DEFAULT 'REFIT-RSS-EOQ-G',
            ADD COLUMN IF NOT EXISTS review_date DATE,
            ADD COLUMN IF NOT EXISTS on_hand_at_review DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS on_order_at_review DOUBLE PRECISION;
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
    # (R, s, S) rule: q = S - IP (research.md §7), no EOQ floor
    order_qty = round(max(1.0, float(row["order_up_to_S"] - row["inventory_position"])), 2)

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
        "on_hand_at_review": round(float(row["on_hand"]), 2),
        "on_order_at_review": round(float(row["on_order"]), 2),
        "eoq_quantity": round(float(row["eoq"]), 2),
        "policy_applied": "REFIT-RSS-EOQ-G",
        "review_date": REVIEW_DATE,
        "created_at": now,
        "decided_at": None,
        "decided_by": None
    })

# atomic replace (DELETE + COPY in ONE transaction; rollback restores the old PENDING rows if COPY fails)
recs_df = pd.DataFrame(recs)
with engine.begin() as conn:
    n = replace_rows(
        conn, "replenishment_recommendations", recs_df,
        "DELETE FROM replenishment_recommendations WHERE store_id = :s AND status IN ('PENDING', 'PROPOSED')",
        {"s": STORE_ID},
    )
print(f"Seeded {n} replenishment recommendations!" if n else "No replenishment recommendations needed.")
