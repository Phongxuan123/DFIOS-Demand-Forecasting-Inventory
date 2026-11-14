import sys
import os

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
if sys.stderr.encoding != 'utf-8':
    try:
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

import math
import uuid
from datetime import datetime, timezone
import pandas as pd
import numpy as np
from sqlalchemy import text

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BE_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
if BE_DIR not in sys.path:
    sys.path.append(BE_DIR)

from app.core.database import engine

C3_CLASS_FILE = os.path.join(SCRIPT_DIR, "c3ok_sku_class.csv")
if not os.path.exists(C3_CLASS_FILE):
    C3_CLASS_FILE = os.path.join(BE_DIR, "MODEL", "c3ok_sku_class.csv")

TIER2_INPUT_FILE = os.path.join(SCRIPT_DIR, "tier2_input.parquet")

STORE_ID = "CA_1"
LEAD_TIME = 7
TAU = 0.95
ORDER_COST = 2.0  # Chuẩn A3: c = 2.0 $/đơn (research.md §7.2)
HOLDING_RATE_DAILY = 0.002  # Chuẩn A3: h = 0.2% * giá/ngày => h_annual = 0.73 * unit_price

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
    merged["class"] = merged["class"].fillna("BY")
    merged["exp_theta"] = merged["class"].map(C3_EXP_THETA).fillna(DEFAULT_EXP_THETA)

    # R-13: Lấy giá sản phẩm thật từ database để tính chi phí A3
    with engine.connect() as conn:
        price_df = pd.read_sql("SELECT item_id, coalesce(price, 3.50) as unit_price FROM products", conn)

    merged = pd.merge(merged, price_df, on="item_id", how="left")
    merged["unit_price"] = merged["unit_price"].fillna(3.50)
    # h_annual = 0.002 * 365 * unit_price (A3: 0.2% giá/ngày)
    merged["holding_cost"] = (HOLDING_RATE_DAILY * 365.0 * merged["unit_price"]).round(4)
    merged["order_cost"] = ORDER_COST

    # B-20: Thống nhất công thức tính SS chuẩn lý thuyết: SS = safety_stock_h7 * exp(theta)
    merged["safety_stock"] = (merged["safety_stock_h7"] * merged["exp_theta"]).round(2).clip(lower=0.0)
    merged["reorder_point"] = (merged["demand_h7"] + merged["safety_stock"]).round(2).clip(lower=0.0)
    merged["annual_demand"] = ((merged["demand_h7"] / LEAD_TIME) * 365.0).round(2).clip(lower=1.0)
    # EOQ = sqrt( 2 * c * D / h )
    merged["eoq"] = np.sqrt((2.0 * merged["annual_demand"] * merged["order_cost"]) / merged["holding_cost"]).round(1).clip(lower=1.0)

    now = datetime.now(timezone.utc)
    merged["id"] = STORE_ID + "_" + merged["item_id"]
    merged["service_level"] = TAU
    merged["lead_time_days"] = LEAD_TIME
    merged["source"] = "c3out"
    merged["updated_at"] = now

    final_params = merged[[
        "id", "item_id", "store_id", "service_level", "lead_time_days",
        "safety_stock", "reorder_point", "eoq", "annual_demand",
        "holding_cost", "order_cost", "unit_price", "source", "updated_at"
    ]]

    # Xây dựng danh sách sku_classifications
    sku_classes = []
    seen_items = set()
    total_rev = (merged["annual_demand"] * merged["unit_price"]).sum()
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
        rev = float(row["annual_demand"] * row["unit_price"])
        rev_share = (rev / total_rev) * 100.0 if total_rev > 0 else 0.0
        cum_share += rev_share

        mean_d = float(row["demand_h7"] / LEAD_TIME)
        std_d = float(row["sigma_d_h7"]) if "sigma_d_h7" in row and pd.notnull(row["sigma_d_h7"]) else 1.0
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
            "cv": round(cv_val, 4),
            "updated_at": now
        })
    sku_classes_df = pd.DataFrame(sku_classes)

    # R-09: Khởi tạo tồn kho và đề xuất khoa học, không dùng quy tắc tùy ý idx % 4 == 0
    with engine.connect() as conn:
        inv_existing = pd.read_sql(f"SELECT item_id, on_hand, on_order FROM inventory WHERE store_id = '{STORE_ID}'", conn)
        suppliers_res = conn.execute(text("SELECT id FROM suppliers")).fetchall()
        supplier_ids = [r[0] for r in suppliers_res] if suppliers_res else ["SUP-001"]

    inv_map = {}
    if not inv_existing.empty:
        for _, inv_r in inv_existing.iterrows():
            inv_map[inv_r["item_id"]] = (float(inv_r["on_hand"] or 0.0), float(inv_r["on_order"] or 0.0))

    inventory_rows = []
    recommendation_rows = []

    for idx, row in merged.iterrows():
        item_id = row["item_id"]
        rop = float(row["reorder_point"])
        ss = float(row["safety_stock"])
        eoq = float(row["eoq"])

        # Sử dụng tồn kho đã có trong DB nếu có; nếu chưa có, khởi tạo bao phủ 10 ngày nhu cầu (L+R=10)
        if item_id in inv_map:
            on_hand, on_order = inv_map[item_id]
        else:
            mean_d = float(row["demand_h7"] / LEAD_TIME)
            on_hand = float(round(mean_d * 10.0))
            on_order = 0.0

        inventory_rows.append({
            "item_id": item_id,
            "store_id": STORE_ID,
            "on_hand": on_hand,
            "on_order": on_order,
            "updated_at": now
        })

        # Chỉ sinh đề xuất đặt hàng khi On_hand + On_order <= ROP theo đúng chính sách (s, S)
        if (on_hand + on_order) <= rop:
            rec_id = str(uuid.uuid4())
            priority = "CRITICAL" if on_hand == 0 else ("HIGH" if on_hand <= ss else "MEDIUM")
            reason = f"Chính sách (s, S) kích hoạt: Tồn khả dụng ({on_hand + on_order:.1f}) <= ROP ({rop:.1f}) [Nhóm {row['class']}]"
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

    inventory_df = pd.DataFrame(inventory_rows)
    recs_df = pd.DataFrame(recommendation_rows)

    print("\n--- Synchronizing C3-OUT inventory data ---")
    with engine.begin() as conn:
        print("1. Deleting stale replenishment recommendations...")
        conn.execute(text("DELETE FROM replenishment_recommendations WHERE store_id = :s"), {"s": STORE_ID})

        print("2. Deleting stale inventory parameters...")
        conn.execute(text("DELETE FROM inventory_params WHERE store_id = :s"), {"s": STORE_ID})

        print("3. Updating inventory levels...")
        conn.execute(text("DELETE FROM inventory WHERE store_id = :s"), {"s": STORE_ID})

        print("4. Deleting stale SKU classifications...")
        conn.execute(text("DELETE FROM sku_classifications"))

    print(f"5. Seeding {len(sku_classes_df)} rows into sku_classifications...")
    sku_classes_df.to_sql("sku_classifications", engine, if_exists="append", index=False, chunksize=1000, method="multi")

    print(f"6. Seeding {len(final_params)} rows into inventory_params...")
    final_params.to_sql("inventory_params", engine, if_exists="append", index=False, chunksize=1000, method="multi")

    print(f"7. Seeding {len(inventory_df)} rows into inventory...")
    inventory_df.to_sql("inventory", engine, if_exists="append", index=False, chunksize=1000, method="multi")

    if not recs_df.empty:
        print(f"8. Seeding {len(recs_df)} recommendations into replenishment_recommendations...")
        recs_df.to_sql("replenishment_recommendations", engine, if_exists="append", index=False, chunksize=1000, method="multi")

    print("=" * 60)
    print("C3-OUT synchronization completed successfully!")
    print(f"- 9 ABC/XYZ segments: {len(sku_classes_df)} SKUs")
    print(f"- C3-OUT parameters: {len(final_params)} SKUs (Model A3: h=0.002*price, c=2.0, b=0.35*price)")
    print(f"- Inventory levels: {len(inventory_df)} SKUs")
    print(f"- Replenishment recommendations: {len(recs_df)} PENDING orders (strict IP <= ROP)")
    print("=" * 60)


if __name__ == "__main__":
    main()
