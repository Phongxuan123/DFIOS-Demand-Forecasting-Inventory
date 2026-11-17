import sys
import os

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, ValueError, OSError):
        pass
if sys.stderr.encoding != 'utf-8':
    try:
        sys.stderr.reconfigure(encoding='utf-8')
    except (AttributeError, ValueError, OSError):
        pass

from datetime import datetime, timezone
import pandas as pd
import numpy as np
from sqlalchemy import text

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BE_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
if BE_DIR not in sys.path:
    sys.path.append(BE_DIR)

from app.core.database import engine
from app.core.db_bulk import psql_insert_copy

C3_CLASS_FILE = os.path.join(SCRIPT_DIR, "c3ok_sku_class.csv")
if not os.path.exists(C3_CLASS_FILE):
    C3_CLASS_FILE = os.path.join(BE_DIR, "MODEL", "c3ok_sku_class.csv")

TIER2_INPUT_FILE = os.path.join(SCRIPT_DIR, "tier2_input.parquet")

from app.services import policy_config as pc

STORE_ID = pc.DEMO_STORE_ID
LEAD_TIME = ARTIFACT_WINDOW_DAYS = 7  # the artifact tier2_input / production_forecast columns are 7-day windows
# B-20: this script no longer computes safety stock / ROP / EOQ (it used L = 7 and a formula that differed from
# load_inventory_params). inventory_params are produced ONLY by OptimizationService (L=3, R=7, H=10).


def build_sku_classes(merged, store_id, thresholds, now):
    """Rows for sku_classifications. SKUs with a class in the source file are ground_truth; SKUs without one
    (class is NaN) are classified by the UC25 thresholds and marked class_source='thresholds' (X-01)."""
    from app.services.classification_service import classification_service

    sku_classes = []
    seen_items = set()
    total_rev = (merged["annual_demand"] * merged["unit_price"]).sum()
    merged_sorted = merged.sort_values(by="annual_demand", ascending=False)
    cum_share = 0.0

    for idx, (_, row) in enumerate(merged_sorted.iterrows()):
        item_id = row["item_id"]
        if item_id in seen_items:
            continue
        seen_items.add(item_id)

        rev = float(row["annual_demand"] * row["unit_price"])
        rev_share = (rev / total_rev) * 100.0 if total_rev > 0 else 0.0
        cum_share += rev_share

        mean_d = float(row["demand_h7"] / ARTIFACT_WINDOW_DAYS)
        std_d = float(row["sigma_d_h7"]) if "sigma_d_h7" in row and pd.notnull(row["sigma_d_h7"]) else 1.0
        cv_val = float(std_d / mean_d) if mean_d > 0.001 else 1.0

        raw = row["class"] if "class" in row else None
        if isinstance(raw, str) and len(raw.strip()) >= 2:
            seg = raw.strip().upper()
            source = "ground_truth"
        else:
            seg = classification_service.threshold_segment(min(100.0, cum_share), cv_val, idx == 0, thresholds)
            source = "thresholds"

        sku_classes.append({
            "id": f"class_{item_id}_{store_id}",
            "item_id": item_id,
            "store_id": store_id,
            "class_source": source,
            "abc_class": seg[0],
            "xyz_class": seg[1],
            "segment": seg,
            "revenue": round(rev, 2),
            "revenue_share": round(rev_share, 4),
            "cumulative_share": round(min(100.0, cum_share), 4),
            "mean_demand": round(mean_d, 2),
            "std_demand": round(std_d, 2),
            "cv": round(cv_val, 4),
            "updated_at": now,
        })
    return sku_classes


def main():
    print("=" * 60)
    print("DFIOS: Synchronizing C3-OUT inventory data (Model A3 & Research Spec)")
    print("=" * 60)

    if not os.path.exists(C3_CLASS_FILE):
        print(f"ERROR: Classification file not found: {C3_CLASS_FILE}")
        return

    print(f"Reading C3-OUT SKU classification: {C3_CLASS_FILE}")
    class_df = pd.read_csv(C3_CLASS_FILE)
    class_df["item_id"] = class_df["id"].apply(lambda x: "_".join(x.split("_")[:3]))
    class_df["store_id"] = class_df["id"].apply(lambda x: "_".join(x.split("_")[3:5]))
    class_ca1 = class_df[class_df["store_id"] == STORE_ID].copy()

    # Nạp thông số nhu cầu và độ lệch chuẩn từ parquet
    if os.path.exists(TIER2_INPUT_FILE):
        print(f"Reading Tier 2 forecast parameters: {TIER2_INPUT_FILE}")
        tier2_df = pd.read_parquet(TIER2_INPUT_FILE)
        tier2_ca1 = tier2_df[tier2_df["store_id"] == STORE_ID].copy()
    else:
        print("Deriving forecast parameters from production_forecast and production_sigma parquet...")
        fc_df = pd.read_parquet(os.path.join(SCRIPT_DIR, "production_forecast.parquet"))
        fc_ca1 = fc_df[(fc_df["store_id"] == STORE_ID) & (fc_df["h"] <= LEAD_TIME)]
        dl_df = fc_ca1.groupby("item_id")["y_pred"].sum().reset_index()
        dl_df.rename(columns={"y_pred": "demand_h7"}, inplace=True)

        sg_df = pd.read_parquet(os.path.join(SCRIPT_DIR, "production_sigma.parquet"))
        sg_df["item_id"] = sg_df["id"].apply(lambda x: "_".join(x.split("_")[:3]))
        sg_ca1 = sg_df[sg_df["id"].str.contains(f"_{STORE_ID}_")].copy()

        tier2_ca1 = pd.merge(dl_df, sg_ca1[["item_id", "sigma_d_h7"]], on="item_id", how="left")
        tier2_ca1["store_id"] = STORE_ID
        tier2_ca1["safety_stock_h7"] = 1.645 * tier2_ca1["sigma_d_h7"].fillna(1.5) * np.sqrt(LEAD_TIME)

    merged = pd.merge(tier2_ca1, class_ca1[["item_id", "class"]], on="item_id", how="left")
    # X-01: SKUs absent from the ground-truth file are NOT forced to BY; they are classified by thresholds below.

    # real product prices (no invented price)
    with engine.connect() as conn:
        price_df = pd.read_sql("SELECT item_id, coalesce(price, 3.50) as unit_price FROM products", conn)
    merged = pd.merge(merged, price_df, on="item_id", how="left")
    merged["unit_price"] = merged["unit_price"].fillna(3.50)
    merged["annual_demand"] = ((merged["demand_h7"] / ARTIFACT_WINDOW_DAYS) * 365.0).round(2).clip(lower=1.0)
    now = datetime.now(timezone.utc)

    from app.core.database import SessionLocal
    from app.services.classification_service import classification_service
    _db = SessionLocal()
    try:
        thresholds = classification_service.get_thresholds(_db)
    finally:
        _db.close()
    now = datetime.now(timezone.utc)
    sku_classes = build_sku_classes(merged, STORE_ID, thresholds, now)
    sku_classes_df = pd.DataFrame(sku_classes)

    # Initial stock: keep what is in the DB; otherwise cover H = L + R = 10 days of the artifact demand rate.
    with engine.connect() as conn:
        inv_existing = pd.read_sql(f"SELECT item_id, on_hand, on_order FROM inventory WHERE store_id = '{STORE_ID}'", conn)
    inv_map = {r["item_id"]: (float(r["on_hand"] or 0.0), float(r["on_order"] or 0.0))
               for _, r in inv_existing.iterrows()}
    inventory_rows = []
    for _, row in merged.iterrows():
        item_id = row["item_id"]
        if item_id in inv_map:
            on_hand, on_order = inv_map[item_id]
        else:
            on_hand = float(round(row["demand_h7"] / ARTIFACT_WINDOW_DAYS * pc.HORIZON_DAYS))
            on_order = 0.0
        inventory_rows.append({"item_id": item_id, "store_id": STORE_ID, "on_hand": on_hand,
                               "on_order": on_order, "updated_at": now})
    inventory_df = pd.DataFrame(inventory_rows)

    print("1. Updating inventory levels...")
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM inventory WHERE store_id = :s"), {"s": STORE_ID})
        print("2. Replacing SKU classifications of this store (ground truth, other stores untouched)...")
        conn.execute(text("DELETE FROM sku_classifications WHERE store_id = :s"), {"s": STORE_ID})

    print(f"3. Seeding {len(sku_classes_df)} rows into sku_classifications...")
    sku_classes_df.to_sql("sku_classifications", engine, if_exists="append", index=False, method=psql_insert_copy)

    print(f"4. Seeding {len(inventory_df)} rows into inventory...")
    inventory_df.to_sql("inventory", engine, if_exists="append", index=False, method=psql_insert_copy)

    print("5. Recomputing inventory_params with the single REFIT-RSS-EOQ-G formula (L=3, R=7)...")
    from app.core.database import SessionLocal
    from app.services.optimization_service import optimization_service
    db = SessionLocal()
    try:
        n = optimization_service.recompute_parameters(db, store_id=STORE_ID)
    finally:
        db.close()

    print("=" * 60)
    print("C3-OUT synchronization completed successfully!")
    print(f"- 9 ABC/XYZ segments: {len(sku_classes_df)} SKUs")
    print(f"- inventory_params: {n} SKUs (Model A3: h=0.002*price, c=2.0, b=0.35*price)")
    print(f"- Inventory levels: {len(inventory_df)} SKUs")
    print("=" * 60)


if __name__ == "__main__":
    main()
