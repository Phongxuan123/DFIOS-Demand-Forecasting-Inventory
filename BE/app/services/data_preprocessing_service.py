import io
import pandas as pd
import numpy as np
from datetime import datetime, timezone
from typing import Dict, Any, Tuple, Optional, List

COLUMN_MAPPING = {
    # Date variants
    "date": "sale_date",
    "Date": "sale_date",
    "ngay_ban": "sale_date",
    "sale_date": "sale_date",
    "timestamp": "sale_date",
    "trans_date": "sale_date",
    "ngay": "sale_date",

    # SKU / Item ID variants
    "item_id": "item_id",
    "Item_Id": "item_id",
    "SKU": "item_id",
    "sku": "item_id",
    "ma_sp": "item_id",
    "product_id": "item_id",
    "id": "item_id",

    # Store variants
    "store_id": "store_id",
    "Store_Id": "store_id",
    "store": "store_id",
    "kho": "store_id",
    "ma_kho": "store_id",
    "branch": "store_id",

    # Sales / Demand quantity variants
    "sales": "sales",
    "Sales": "sales",
    "quantity": "sales",
    "qty": "sales",
    "so_luong": "sales",
    "demand": "sales",

    # Price variants
    "price": "price",
    "Price": "price",
    "sell_price": "price",
    "gia": "price",
    "unit_price": "price",
    "don_gia": "price",
}


class DataPreprocessingService:
    """
    Dịch vụ chuẩn hóa dữ liệu đầu vào (Task PRE.3):
    - Tự động nhận diện và map tên cột biến thể (tiếng Việt / tiếng Anh).
    - Resampling dải ngày liên tục và điền zero-sales cho nhu cầu gián đoạn.
    - Sinh Data Quality Report chi tiết.
    """

    def normalize_columns(self, df: pd.DataFrame) -> Tuple[pd.DataFrame, Dict[str, str]]:
        """
        Map các cột của DataFrame đầu vào về schema chuẩn.
        """
        mapped_cols = {}
        rename_dict = {}

        for col in df.columns:
            clean_col = str(col).strip()
            if clean_col in COLUMN_MAPPING:
                target = COLUMN_MAPPING[clean_col]
                rename_dict[col] = target
                mapped_cols[clean_col] = target
            else:
                # Thử tìm kiếm case-insensitive
                lower_col = clean_col.lower()
                for k, v in COLUMN_MAPPING.items():
                    if lower_col == k.lower():
                        rename_dict[col] = v
                        mapped_cols[clean_col] = v
                        break

        df_mapped = df.rename(columns=rename_dict)
        return df_mapped, mapped_cols

    def preprocess_sales_data(
        self,
        file_content: bytes,
        file_name: str = "upload.csv",
        default_store_id: str = "CA_1",
    ) -> Tuple[pd.DataFrame, Dict[str, Any]]:
        """
        Nhận file CSV dạng bytes, làm sạch, chuẩn hóa schema, zero-fill và xuất báo cáo chất lượng.
        """
        raw_df = pd.read_csv(io.BytesIO(file_content))
        raw_rows = len(raw_df)

        df, mapped_cols = self.normalize_columns(raw_df)

        # Kiểm tra các cột bắt buộc tối thiểu
        required = ["sale_date", "item_id", "sales"]
        missing = [c for c in required if c not in df.columns]
        if missing:
            raise ValueError(f"Thiếu các cột bắt buộc: {missing}. Các cột tìm thấy: {list(raw_df.columns)}")

        # Gán mặc định nếu thiếu store_id hoặc price
        if "store_id" not in df.columns:
            df["store_id"] = default_store_id
        else:
            df["store_id"] = df["store_id"].fillna(default_store_id).astype(str)

        if "price" not in df.columns:
            df["price"] = 1.0
        else:
            df["price"] = pd.to_numeric(df["price"], errors="coerce").fillna(1.0)

        # Chuẩn hóa kiểu dữ liệu
        df["item_id"] = df["item_id"].astype(str).str.strip()
        df["sale_date"] = pd.to_datetime(df["sale_date"], errors="coerce")
        df = df.dropna(subset=["sale_date", "item_id"])
        df["sales"] = pd.to_numeric(df["sales"], errors="coerce").fillna(0.0)
        df["sales"] = df["sales"].clip(lower=0.0)

        # Gộp doanh số nếu có nhiều dòng trùng (store_id, item_id, sale_date)
        df = df.groupby(["store_id", "item_id", "sale_date"], as_index=False).agg({
            "sales": "sum",
            "price": "mean",
        })

        # Resampling & Zero-filling liên tục theo từng chuỗi SKU
        resampled_list = []
        unique_skus = df["item_id"].nunique()
        min_overall_date = df["sale_date"].min()
        max_overall_date = df["sale_date"].max()

        for (store, sku), group in df.groupby(["store_id", "item_id"]):
            group = group.set_index("sale_date").sort_index()
            # Sử dụng dải ngày liên tục
            idx = pd.date_range(group.index.min(), group.index.max(), freq="D")
            reindexed = group.reindex(idx)
            reindexed["store_id"] = store
            reindexed["item_id"] = sku
            reindexed["sales"] = reindexed["sales"].fillna(0.0)
            reindexed["price"] = reindexed["price"].ffill().bfill().fillna(1.0)
            reindexed = reindexed.reset_index().rename(columns={"index": "sale_date"})
            resampled_list.append(reindexed)

        if resampled_list:
            clean_df = pd.concat(resampled_list, ignore_index=True)
        else:
            clean_df = pd.DataFrame(columns=["store_id", "item_id", "sale_date", "sales", "price"])

        total_clean_rows = len(clean_df)
        zero_sales_count = int((clean_df["sales"] == 0).sum())
        zero_sales_pct = round((zero_sales_count / total_clean_rows * 100), 2) if total_clean_rows > 0 else 0.0

        quality_report = {
            "file_name": file_name,
            "raw_rows": raw_rows,
            "clean_rows": total_clean_rows,
            "unique_skus": unique_skus,
            "date_range": {
                "start": min_overall_date.strftime("%Y-%m-%d") if pd.notnull(min_overall_date) else None,
                "end": max_overall_date.strftime("%Y-%m-%d") if pd.notnull(max_overall_date) else None,
                "total_days": int((max_overall_date - min_overall_date).days + 1) if pd.notnull(min_overall_date) and pd.notnull(max_overall_date) else 0,
            },
            "zero_sales_pct": zero_sales_pct,
            "schema_mapping": mapped_cols,
            "status": "PASSED" if unique_skus > 0 else "FAILED",
        }

        return clean_df, quality_report


data_preprocessing_service = DataPreprocessingService()
