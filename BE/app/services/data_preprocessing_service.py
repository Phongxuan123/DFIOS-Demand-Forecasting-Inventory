import io
import re
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
    "thời gian tạo đơn": "sale_date",
    "th?i gian t?o ??n": "sale_date",
    "thoi_gian_tao_don": "sale_date",
    "thoi gian tao don": "sale_date",
    "thời gian": "sale_date",
    "thoi_gian": "sale_date",
    "ngay_tao": "sale_date",
    "created_at": "sale_date",
    "order_date": "sale_date",

    # SKU / Item ID variants
    "item_id": "item_id",
    "Item_Id": "item_id",
    "SKU": "item_id",
    "sku": "item_id",
    "ma_sp": "item_id",
    "product_id": "item_id",
    "id": "item_id",
    "mã mặt hàng": "item_id",
    "mã m?t hàng": "item_id",
    "mă m?t hàng": "item_id",
    "ma_mat_hang": "item_id",
    "ma mat hang": "item_id",
    "mã hàng": "item_id",
    "ma_hang": "item_id",
    "mã sản phẩm": "item_id",
    "ma_san_pham": "item_id",
    "item_code": "item_id",
    "product_code": "item_id",

    # Store variants
    "store_id": "store_id",
    "Store_Id": "store_id",
    "store": "store_id",
    "kho": "store_id",
    "ma_kho": "store_id",
    "mã kho": "store_id",
    "branch": "store_id",
    "chi_nhanh": "store_id",
    "chi nhánh": "store_id",
    "cua_hang": "store_id",
    "cửa hàng": "store_id",

    # Sales / Demand quantity variants
    "sales": "sales",
    "Sales": "sales",
    "quantity": "sales",
    "qty": "sales",
    "so_luong": "sales",
    "số lượng": "sales",
    "so luong": "sales",
    "sl": "sales",
    "SL": "sales",
    "demand": "sales",
    "so_luong_ban": "sales",

    # Price variants
    "price": "price",
    "Price": "price",
    "sell_price": "price",
    "gia": "price",
    "unit_price": "price",
    "don_gia": "price",
    "đơn giá": "price",
    "??n giá": "price",
    "don gia": "price",
    "đơn giá bán": "price",
}


class DataPreprocessingService:
    """
    Dịch vụ chuẩn hóa dữ liệu đầu vào (Task PRE.3):
    - Tự động nhận diện encoding (UTF-8, Latin1, CP1252) và separator (,, ;, \t).
    - Tự động nhận diện và map tên cột biến thể (tiếng Việt / tiếng Anh).
    - Hỗ trợ dữ liệu giao dịch đơn hàng (transaction logs) lẫn bảng tổng hợp ngày.
    - Resampling dải ngày liên tục và điền zero-sales cho nhu cầu gián đoạn.
    - Sinh Data Quality Report chi tiết.
    """

    def read_csv_safely(self, file_content: bytes) -> pd.DataFrame:
        """
        Đọc file CSV tự động nhận dạng bảng mã và dấu phân cách linh hoạt.
        """
        encodings = ["utf-8", "utf-8-sig", "latin1", "cp1252", "windows-1258"]
        for enc in encodings:
            try:
                text_data = file_content.decode(enc)
                lines = [line for line in text_data.splitlines() if line.strip()]
                if not lines:
                    continue
                first_line = lines[0]

                # Đếm và chọn dấu phân cách xuất hiện nhiều nhất ở dòng tiêu đề
                counts = {
                    ";": first_line.count(";"),
                    ",": first_line.count(","),
                    "\t": first_line.count("\t"),
                    "|": first_line.count("|"),
                }
                detected_sep = max(counts, key=counts.get)
                if counts[detected_sep] == 0:
                    detected_sep = ","

                df = pd.read_csv(io.StringIO(text_data), sep=detected_sep)
                if df.shape[1] >= 2:
                    return df
            except Exception:
                continue

        # Fallback cuối cùng
        return pd.read_csv(io.BytesIO(file_content), sep=None, engine="python", encoding="latin1")

    def normalize_columns(self, df: pd.DataFrame) -> Tuple[pd.DataFrame, Dict[str, str]]:
        """
        Map các cột của DataFrame đầu vào về schema chuẩn.
        """
        mapped_cols = {}
        rename_dict = {}

        for col in df.columns:
            clean_col = str(col).strip()
            # 1. Khớp chính xác
            if clean_col in COLUMN_MAPPING:
                target = COLUMN_MAPPING[clean_col]
                rename_dict[col] = target
                mapped_cols[clean_col] = target
                continue

            # 2. Khớp chữ thường và chuẩn hóa khoảng trắng
            lower_col = re.sub(r"\s+", " ", clean_col.lower())
            if lower_col in COLUMN_MAPPING:
                target = COLUMN_MAPPING[lower_col]
                rename_dict[col] = target
                mapped_cols[clean_col] = target
                continue

            # 3. Khớp mờ theo từ khóa thông dụng nếu cột chưa được gán
            assigned_targets = set(rename_dict.values())
            if any(k in lower_col for k in ["thoi gian", "th?i gian", "thời gian", "ngay", "date", "timestamp"]) and "sale_date" not in assigned_targets:
                rename_dict[col] = "sale_date"
                mapped_cols[clean_col] = "sale_date"
            elif any(k in lower_col for k in ["m?t hàng", "mat hang", "mặt hàng", "san pham", "sản phẩm", "item", "sku", "product"]) and "item_id" not in assigned_targets:
                # Đảm bảo không map nhầm tên mặt hàng sang item_id nếu có mã mặt hàng
                if any(m in lower_col for m in ["mã", "ma", "mă", "id", "sku", "code"]):
                    rename_dict[col] = "item_id"
                    mapped_cols[clean_col] = "item_id"
            elif lower_col in ["sl", "qty", "so luong", "số lượng", "so_luong", "quantity", "sales", "demand"] and "sales" not in assigned_targets:
                rename_dict[col] = "sales"
                mapped_cols[clean_col] = "sales"
            elif any(k in lower_col for k in ["don gia", "đơn giá", "??n giá", "gia", "price"]) and "price" not in assigned_targets:
                rename_dict[col] = "price"
                mapped_cols[clean_col] = "price"
            elif any(k in lower_col for k in ["kho", "store", "branch", "chi nhanh"]) and "store_id" not in assigned_targets:
                rename_dict[col] = "store_id"
                mapped_cols[clean_col] = "store_id"

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
        raw_df = self.read_csv_safely(file_content)
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
        # Chuẩn hóa về mức ngày (loại bỏ giờ:phút:giây của transactional log)
        df["sale_date"] = df["sale_date"].dt.normalize()
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

