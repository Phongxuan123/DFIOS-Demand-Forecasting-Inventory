import sys
import os

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')
if sys.stderr.encoding != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8')

import math
import uuid
from datetime import datetime, timezone
import pandas as pd
import numpy as np
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BE_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
if BE_DIR not in sys.path:
    sys.path.append(BE_DIR)

from app.core.database import engine

C3_CLASS_FILE = os.path.join(SCRIPT_DIR, "c3ok_sku_class.csv")
TIER2_INPUT_FILE = os.path.join(SCRIPT_DIR, "tier2_input.parquet")

STORE_ID = "CA_1"
LEAD_TIME = 7
TAU = 0.95
ORDER_COST = 2.0
HOLDING_COST = 2.0

C3_EXP_THETA = {
    "AX": 1.095,
    "AY": 1.201,
    "AZ": 1.481,
    "BX": 1.094,
    "BY": 1.172,
    "BZ": 1.468,
    "CX": 1.149,
    "CY": 1.133,
    "CZ": 1.397,
}
DEFAULT_EXP_THETA = 1.15


def main():
    print("=" * 60)
    print("DFIOS: Synchronizing C3-OUT inventory data (Report 4 & 5)")
    print("=" * 60)

    with engine.connect() as conn:
        existing_classes = conn.execute(text("SELECT COUNT(*) FROM sku_classifications")).scalar()
        existing_params = conn.execute(text("SELECT COUNT(*) FROM inventory_params WHERE store_id = :s"), {"s": STORE_ID}).scalar()

    if existing_classes > 0 and existing_params > 0:
        print(f"Data already synchronized on database ({existing_classes} SKUs classified). Nothing to do.")
        print("=" * 60)
        return

    if not os.path.exists(C3_CLASS_FILE):
        print(f"ERROR: File not found: {C3_CLASS_FILE}")
        return
    if not os.path.exists(TIER2_INPUT_FILE):
        print(f"ERROR: File not found: {TIER2_INPUT_FILE}")
        return

    print(f"Reading C3-OUT SKU classification: {C3_CLASS_FILE}")
    class_df = pd.read_csv(C3_CLASS_FILE)
    class_df["item_id"] = class_df["id"].apply(lambda x: "_".join(x.split("_")[:3]))
    class_df["store_id"] = class_df["id"].apply(lambda x: "_".join(x.split("_")[3:5]))

    print(f"Reading Tier 2 forecast parameters: {TIER2_INPUT_FILE}")
    tier2_df = pd.read_parquet(TIER2_INPUT_FILE)

    tier2_ca1 = tier2_df[tier2_df["store_id"] == STORE_ID].copy()
    class_ca1 = class_df[class_df["store_id"] == STORE_ID].copy()

    merged = pd.merge(tier2_ca1, class_ca1[["item_id", "class"]], on="item_id", how="left")
    merged["class"] = merged["class"].fillna("BY")
    merged["exp_theta"] = merged["class"].map(C3_EXP_THETA).fillna(DEFAULT_EXP_THETA)

    merged["safety_stock"] = (merged["safety_stock_h7"] * merged["exp_theta"]).round(2).clip(lower=0.0)
    merged["reorder_point"] = (merged["demand_h7"] + merged["safety_stock"]).round(2).clip(lower=0.0)
    merged["annual_demand"] = ((merged["demand_h7"] / LEAD_TIME) * 365).round(2).clip(lower=1.0)
    merged["eoq"] = np.sqrt((2 * merged["annual_demand"] * ORDER_COST) / HOLDING_COST).round(2).clip(lower=1.0)

    now = datetime.now(timezone.utc)
    merged["id"] = STORE_ID + "_" + merged["item_id"]
    merged["service_level"] = TAU
    merged["lead_time_days"] = LEAD_TIME
    merged["holding_cost"] = HOLDING_COST
    merged["order_cost"] = ORDER_COST
    merged["unit_price"] = 10.0
    merged["source"] = "c3out"
    merged["updated_at"] = now

    final_params = merged[[
        "id", "item_id", "store_id", "service_level", "lead_time_days",
        "safety_stock", "reorder_point", "eoq", "annual_demand",
        "holding_cost", "order_cost", "unit_price", "source", "updated_at"
    ]]

    sku_classes = []
    seen_items = set()
    total_rev = (merged["annual_demand"] * 10.0).sum()
    merged_sorted = merged.sort_values(by="annual_demand", ascending=False)
    cum_share = 0.0

    for _, row in merged_sorted.iterrows():
        item_id = row["item_id"]
        if item_id in seen_items:
            continue
        seen_items.add(item_id)
        
        seg = row["class"]
        abc = seg[0] if len(seg) >= 1 else "B"
        xyz = seg[1] if len(seg) >= 2 else "Y"
        rev = float(row["annual_demand"] * 10.0)
        rev_share = (rev / total_rev) * 100.0 if total_rev > 0 else 0.0
        cum_share += rev_share
        
        mean_d = float(row["demand_h7"] / LEAD_TIME)
        std_d = float(row["sigma_d_h7"])
        cv_val = float(std_d / mean_d) if mean_d > 0.001 else 1.0

        sku_classes.append({
            "id": f"class_{item_id}",
            "item_id": item_id,
            "abc_class": abc,
            "xyz_class": xyz,
            "segment": seg,
            "revenue": round(rev, 2),
            "revenue_share": round(rev_share, 4),
            "cumulative_share": round(min(100.0, cum_share), 4),
            "mean_demand": round(mean_d, 2),
            "std_demand": round(std_d, 2),
            "cv": round(cv_val, 2),
            "updated_at": now
        })
    sku_classes_df = pd.DataFrame(sku_classes)

    inventory_rows = []
    recommendation_rows = []

    with engine.connect() as conn:
        suppliers_res = conn.execute(text("SELECT id FROM suppliers")).fetchall()
        supplier_ids = [r[0] for r in suppliers_res] if suppliers_res else ["SUP-001"]

    for idx, row in merged.iterrows():
        item_id = row["item_id"]
        rop = row["reorder_point"]
        ss = row["safety_stock"]
        eoq = row["eoq"]

        needs_reorder = (idx % 4 == 0) or row["class"].endswith("Z")

        if needs_reorder:
            on_hand = float(round(max(0.0, rop - 2.0)))
            on_order = 0.0
            
            rec_id = str(uuid.uuid4())
            priority = "CRITICAL" if on_hand == 0 else ("HIGH" if on_hand < ss else "MEDIUM")
            reason = f"C3-OUT trigger: On-hand ({on_hand:.0f}) + On-order ({on_order:.0f}) <= ROP ({rop:.0f}) [Class {row['class']}, exp(theta)={row['exp_theta']}]"
            sup_id = supplier_ids[idx % len(supplier_ids)]

            recommendation_rows.append({
                "id": rec_id,
                "item_id": item_id,
                "store_id": STORE_ID,
                "supplier_id": sup_id,
                "recommended_qty": eoq,
                "final_qty": eoq,
                "priority": priority,
                "status": "PENDING",
                "reason": reason,
                "decided_by": None,
                "created_at": now,
                "decided_at": None
            })
        else:
            on_hand = float(round(rop + eoq * 0.6))
            on_order = 0.0

        inventory_rows.append({
            "item_id": item_id,
            "store_id": STORE_ID,
            "on_hand": on_hand,
            "on_order": on_order,
            "updated_at": now
        })

    inventory_df = pd.DataFrame(inventory_rows)
    recs_df = pd.DataFrame(recommendation_rows)

    print("\n--- Synchronizing C3-OUT inventory data ---")
    with engine.begin() as conn:
        print("1. Deleting stale replenishment recommendations...")
        conn.execute(text("DELETE FROM replenishment_recommendations WHERE store_id = :s"), {"s": STORE_ID})

        print("2. Deleting stale inventory parameters...")
        conn.execute(text("DELETE FROM inventory_params WHERE store_id = :s"), {"s": STORE_ID})

        print("3. Deleting stale inventory levels...")
        conn.execute(text("DELETE FROM inventory WHERE store_id = :s"), {"s": STORE_ID})

        print("4. Deleting stale SKU classifications...")
        conn.execute(text("DELETE FROM sku_classifications"))

    print(f"5. Seeding {len(sku_classes_df)} rows into sku_classifications...")
    sku_classes_df.to_sql("sku_classifications", engine, if_exists="append", index=False, chunksize=1000, method="multi")

    print(f"6. Seeding {len(final_params)} rows into inventory_params...")
    final_params.to_sql("inventory_params", engine, if_exists="append", index=False, chunksize=1000, method="multi")

    print(f"7. Seeding {len(inventory_df)} rows into inventory...")
    inventory_df.to_sql("inventory", engine, if_exists="append", index=False, chunksize=1000, method="multi")

    print(f"8. Seeding {len(recs_df)} recommendations into replenishment_recommendations...")
    recs_df.to_sql("replenishment_recommendations", engine, if_exists="append", index=False, chunksize=1000, method="multi")

    print("=" * 60)
    print("C3-OUT synchronization completed successfully!")
    print(f"- 9 ABC/XYZ segments: {len(sku_classes_df)} SKUs")
    print(f"- C3-OUT parameters: {len(final_params)} SKUs (Service level 0.95, exp(theta) 1.094 - 1.481)")
    print(f"- Inventory levels: {len(inventory_df)} SKUs")
    print(f"- Replenishment recommendations: {len(recs_df)} PENDING orders")
    print("=" * 60)


if __name__ == "__main__":
    main()
