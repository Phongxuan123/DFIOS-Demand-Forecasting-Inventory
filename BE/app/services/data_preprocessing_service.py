import io
import re
import pandas as pd
from typing import Dict, Any, Tuple, List

# Cột chuẩn của template import (N-23) – nguồn duy nhất cho BE và FE (GET /imports/template).
TEMPLATE_COLUMNS: List[Dict[str, Any]] = [
    {"name": "item_id", "required": True, "type": "string",
     "description": "Mã SKU, phải tồn tại trong danh mục sản phẩm", "example": "FOODS_1_001"},
    {"name": "store_id", "required": False, "type": "string",
     "description": "Mã kho. Bỏ trống thì lấy tham số store_id; nếu có thì phải trùng kho đích", "example": "CA_1"},
    {"name": "sale_date", "required": True, "type": "date",
     "description": "Ngày bán, ISO YYYY-MM-DD (khuyến nghị) hoặc DD/MM/YYYY, một định dạng duy nhất cho cả file",
     "example": "2016-04-25"},
    {"name": "quantity", "required": True, "type": "number",
     "description": "Số lượng bán trong ngày (>= 0)", "example": "15"},
    {"name": "sell_price", "required": False, "type": "number",
     "description": "Đơn giá bán (không bắt buộc)", "example": "2.50"},
]

_ISO_DATE_RE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$")
_ISO_SLASH_RE = re.compile(r"^(\d{4})/(\d{1,2})/(\d{1,2})(?:[T ].*)?$")
_ISO_COMPACT_RE = re.compile(r"^(\d{4})(\d{2})(\d{2})$")
_DMY_RE = re.compile(r"^(\d{1,2})([/.\-])(\d{1,2})\2(\d{4})(?:[T ].*)?$")


def parse_sale_dates(values: pd.Series) -> Tuple[pd.Series, Dict[str, Any]]:
    """
    P-03 / N-22: parse cột ngày theo định dạng được NHẬN DIỆN TƯỜNG MINH, không đoán từng dòng.

    - ISO (YYYY-MM-DD, YYYY/MM/DD, YYYYMMDD): parse chặt theo năm-tháng-ngày, không bao giờ đảo ngày/tháng.
    - D/M/Y hoặc M/D/Y (dấu / . -): thứ tự được suy ra từ CẢ CỘT. Có giá trị > 12 ở vị trí đầu thì là DD/MM;
      ở vị trí thứ hai thì là MM/DD. Nếu cả hai cùng xuất hiện thì báo lỗi. Nếu không có giá trị nào > 12
      (mơ hồ hoàn toàn) thì dùng DD/MM/YYYY theo template và ghi cảnh báo.
    - File trộn ISO với D/M/Y bị từ chối (ValueError) thay vì âm thầm ghi sai ngày.

    Trả về (Series datetime64 mức ngày, NaT cho dòng không parse được; info).
    """
    if pd.api.types.is_datetime64_any_dtype(values):
        return pd.to_datetime(values).dt.normalize(), {"date_format": "datetime", "invalid_dates": 0, "warnings": []}

    text_vals = values.astype(str).str.strip()
    years: List[Any] = []
    months: List[Any] = []
    days: List[Any] = []
    kinds: List[str] = []
    for v in text_vals:
        m = _ISO_DATE_RE.match(v) or _ISO_SLASH_RE.match(v) or _ISO_COMPACT_RE.match(v)
        if m:
            kinds.append("iso")
            years.append(int(m.group(1)))
            months.append(int(m.group(2)))
            days.append(int(m.group(3)))
            continue
        m = _DMY_RE.match(v)
        if m:
            kinds.append("dmy")
            years.append(int(m.group(4)))
            months.append(int(m.group(3)))  # tạm coi vị trí 2 là tháng; hoán đổi bên dưới nếu là MM/DD
            days.append(int(m.group(1)))
            continue
        kinds.append("bad")
        years.append(None)
        months.append(None)
        days.append(None)

    n_iso = kinds.count("iso")
    n_dmy = kinds.count("dmy")
    warnings: List[str] = []

    if n_iso and n_dmy:
        raise ValueError(
            f"Cột ngày trộn nhiều định dạng ({n_iso} dòng ISO YYYY-MM-DD và {n_dmy} dòng dạng DD/MM/YYYY). "
            "Hãy dùng một định dạng duy nhất cho cả file (khuyến nghị YYYY-MM-DD)."
        )

    date_format = "YYYY-MM-DD" if n_iso else None
    if n_dmy:
        first_gt12 = any(k == "dmy" and d > 12 for k, d in zip(kinds, days))
        second_gt12 = any(k == "dmy" and mo > 12 for k, mo in zip(kinds, months))
        if first_gt12 and second_gt12:
            raise ValueError(
                "Cột ngày không nhất quán: có dòng chỉ hợp lệ theo DD/MM/YYYY và có dòng chỉ hợp lệ theo MM/DD/YYYY. "
                "Hãy dùng một định dạng duy nhất cho cả file (khuyến nghị YYYY-MM-DD)."
            )
        if second_gt12:
            date_format = "MM/DD/YYYY"
            days, months = months, days
        elif first_gt12:
            date_format = "DD/MM/YYYY"
        else:
            date_format = "DD/MM/YYYY"
            warnings.append(
                "Ngày dạng xx/xx/yyyy không có giá trị nào > 12 nên không phân biệt được DD/MM với MM/DD; "
                "đã hiểu là DD/MM/YYYY theo template. Dùng YYYY-MM-DD để tránh mơ hồ."
            )

    parsed = pd.to_datetime(
        pd.DataFrame({"year": years, "month": months, "day": days}, index=values.index, dtype="float64"),
        errors="coerce",
    )
    invalid = int(parsed.isna().sum())
    return parsed, {"date_format": date_format, "invalid_dates": invalid, "warnings": warnings}

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

    MAX_REJECTED_SAMPLES = 100

    def read_csv_safely(self, file_content: bytes) -> pd.DataFrame:
        """
        Đọc file CSV tự động nhận dạng bảng mã và dấu phân cách linh hoạt.
        """
        encodings = ["utf-8-sig", "utf-8", "cp1258", "windows-1258", "cp1252", "latin1"]
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
        known_item_ids: Any = None,
    ) -> Tuple[pd.DataFrame, Dict[str, Any]]:
        """
        Nhận file CSV dạng bytes, làm sạch, chuẩn hóa schema, zero-fill và xuất báo cáo chất lượng.

        `default_store_id` là kho đích DUY NHẤT của lần import (P-26).
        `known_item_ids` (tập mã SKU hợp lệ): nếu truyền vào, dòng có SKU lạ bị từ chối (N-09).
        Dòng bị từ chối được đếm trong `rejected_count` và liệt kê mẫu trong `rejected_rows`.
        """
        raw_df = self.read_csv_safely(file_content)
        raw_rows = len(raw_df)

        df, mapped_cols = self.normalize_columns(raw_df)

        # Kiểm tra các cột bắt buộc tối thiểu
        required = ["sale_date", "item_id", "sales"]
        missing = [c for c in required if c not in df.columns]
        if missing:
            raise ValueError(f"Thiếu các cột bắt buộc: {missing}. Các cột tìm thấy: {list(raw_df.columns)}")

        rejected_rows: List[Dict[str, Any]] = []
        rejected_count = 0

        def _reject(frame: pd.DataFrame, mask: pd.Series, reason: str) -> int:
            for idx in frame.index[mask]:
                if len(rejected_rows) >= self.MAX_REJECTED_SAMPLES:
                    break
                raw_item = frame.at[idx, "item_id"]
                rejected_rows.append({
                    "row": int(idx) + 2,  # +1 dòng header, +1 vì đánh số từ 1
                    "item_id": None if pd.isna(raw_item) else str(raw_item),
                    "reason": reason,
                })
            return int(mask.sum())

        # P-26: MỘT kho duy nhất cho cả lần import. Cột store_id trong CSV (nếu có) phải trùng kho đích;
        # ô trống được gán kho đích, dòng thuộc kho khác bị từ chối (không ghi lẫn sang kho khác).
        if "store_id" not in df.columns:
            df["store_id"] = default_store_id
        else:
            store_col = df["store_id"].astype("string").str.strip()
            store_col = store_col.mask(store_col.str.lower().isin(["", "nan", "none", "null", "<na>"]))
            store_col = store_col.fillna(default_store_id).astype(str)
            df["store_id"] = store_col
            wrong_store = store_col != default_store_id
            if wrong_store.any():
                rejected_count += _reject(df, wrong_store, f"store_id khác kho đích '{default_store_id}'")
                df = df[~wrong_store].copy()

        if "price" not in df.columns:
            df["price"] = 1.0
        else:
            df["price"] = pd.to_numeric(df["price"], errors="coerce").fillna(1.0)

        # N-22: loại dòng thiếu item_id / ngày TRƯỚC khi ép kiểu chuỗi (tránh sinh SKU "nan")
        item_str = df["item_id"].astype(str).str.strip()
        missing_key = (
            df["item_id"].isna()
            | df["sale_date"].isna()
            | item_str.str.lower().isin(["nan", "none", "null", ""])
        )
        if missing_key.any():
            rejected_count += _reject(df, missing_key, "thiếu item_id hoặc sale_date")
        df = df[~missing_key].copy()
        df["item_id"] = df["item_id"].astype(str).str.strip()

        # P-03 / N-22: nhận diện định dạng ngày tường minh, không đảo ngày ISO
        parsed_dates, date_info = parse_sale_dates(df["sale_date"])
        bad_date = parsed_dates.isna()
        if bad_date.any():
            rejected_count += _reject(df, bad_date, "sale_date không hợp lệ")
        df["sale_date"] = parsed_dates
        df = df[~bad_date].copy()

        qty = pd.to_numeric(df["sales"], errors="coerce")
        bad_qty = qty.isna() | (qty < 0)
        if bad_qty.any():
            rejected_count += _reject(df, bad_qty, "quantity không phải số hoặc âm")
        df["sales"] = qty
        df = df[~bad_qty].copy()

        # N-09: không tự tạo Product. SKU không có trong danh mục bị từ chối và báo lại.
        if known_item_ids is not None:
            unknown = ~df["item_id"].isin(list(known_item_ids))
            if unknown.any():
                rejected_count += _reject(df, unknown, "item_id không tồn tại trong danh mục sản phẩm")
            df = df[~unknown].copy()
        accepted_raw_rows = int(len(df))

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
            "date_format": date_info.get("date_format"),
            "warnings": date_info.get("warnings", []),
            "accepted_rows": accepted_raw_rows,
            "rejected_count": rejected_count,
            "rejected_rows": rejected_rows,
            "status": "PASSED" if unique_skus > 0 else "FAILED",
        }

        return clean_df, quality_report


data_preprocessing_service = DataPreprocessingService()

