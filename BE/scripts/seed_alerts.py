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

alerts = []
for _, row in reorder_items.iterrows():
    alert_type = "CRITICAL_OUT_OF_STOCK" if row["on_hand"] == 0 else "WARNING_LOW_STOCK"
    alerts.append({
        "id": str(uuid.uuid4()),
        "item_id": row["item_id"],
        "store_id": STORE_ID,
        "type": alert_type,
        "message": f"Item {row['item_id']} requires replenishment. On-hand: {row['on_hand']}, ROP: {row['reorder_point']}, EOQ: {row['eoq']}",
        "is_read": False,
        "created_at": now
    })

if alerts:
    alerts_df = pd.DataFrame(alerts[:100])
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM alerts WHERE store_id = :s"), {"s": STORE_ID})
    alerts_df.to_sql("alerts", engine, if_exists="append", index=False, chunksize=500, method="multi")
    print(f"Seeded {len(alerts_df)} alerts!")
else:
    print("No alerts needed.")
