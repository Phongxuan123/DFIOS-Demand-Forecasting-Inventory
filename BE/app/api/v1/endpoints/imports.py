import os
import time
import uuid
import pandas as pd
from datetime import datetime, timezone
from typing import Any, Dict
from fastapi import APIRouter, Depends, UploadFile, File, Query, Request, Response, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_manager_or_admin, get_current_user
from app.core.db_bulk import replace_rows
from app.models.user import User
from app.models.data_imports import DataImport
from app.models.inventory import Inventory
from app.models.sales_history import SalesHistory
from app.models.product import Product
from app.models.sim_clock import SimClock
from app.schemas.data_import import FastInferenceRequest, FastInferenceResponse
from app.services.data_preprocessing_service import data_preprocessing_service, TEMPLATE_COLUMNS
from app.services.fast_inference_service import fast_inference_service

router = APIRouter()

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_PATH = os.path.join(SCRIPT_DIR, "../../../scripts/sample_data/template_store_import.csv")

MAX_IMPORT_BYTES = 50 * 1024 * 1024  # 50MB
_READ_CHUNK = 1024 * 1024
FAST_INFERENCE_MODEL_VERSION = "fast-inference-sba"


def _too_large(size_bytes: int) -> HTTPException:
    return HTTPException(
        status_code=413,
        detail=(
            f"Kích thước file ({size_bytes / (1024 * 1024):.1f}MB) vượt quá giới hạn tối đa cho phép "
            f"({MAX_IMPORT_BYTES // (1024 * 1024)}MB)."
        ),
    )


def _read_upload_limited(file: UploadFile, request: Request) -> bytes:
    """
    N-09: kiểm tra kích thước TRƯỚC khi nạp cả file vào RAM.
    1) Content-Length của request, 2) kích thước do multipart parser ghi nhận,
    3) đọc theo khối và dừng ngay khi vượt ngưỡng (phòng header khai sai).
    """
    declared = request.headers.get("content-length") if request is not None else None
    if declared and declared.isdigit() and int(declared) > MAX_IMPORT_BYTES + 64 * 1024:
        raise _too_large(int(declared))
    known_size = getattr(file, "size", None)
    if isinstance(known_size, int) and known_size > MAX_IMPORT_BYTES:
        raise _too_large(known_size)

    chunks = []
    total = 0
    while True:
        chunk = file.file.read(_READ_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_IMPORT_BYTES:
            raise _too_large(total)
        chunks.append(chunk)
    return b"".join(chunks)


def _template_csv() -> str:
    if os.path.exists(TEMPLATE_PATH):
        with open(TEMPLATE_PATH, "r", encoding="utf-8") as f:
            return f.read()
    header = ",".join(c["name"] for c in TEMPLATE_COLUMNS)
    example = ",".join(str(c["example"]) for c in TEMPLATE_COLUMNS)
    return f"{header}\n{example}\n"


@router.post(
    "/imports",
    summary="Task API.2 - Tải lên CSV kho hàng mới và trả về báo cáo chất lượng dữ liệu (Data Quality Report)",
)
def upload_store_data(
    request: Request,
    file: UploadFile = File(..., description="File CSV dữ liệu bán hàng"),
    store_id: str = Query(..., description="Mã kho hàng/cửa hàng (bắt buộc chỉ định mã kho cụ thể)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
) -> Dict[str, Any]:
    """
    **Task API.2 - Import Store CSV**:
    Tải lên file CSV bán lẻ theo template `GET /imports/template`.

    - Toàn bộ dữ liệu được ghi cho ĐÚNG MỘT kho: `store_id` của query. Dòng CSV thuộc kho khác bị từ chối.
    - SKU không có trong danh mục sản phẩm KHÔNG được tự tạo; các dòng đó bị từ chối và liệt kê trong `rejected_rows`.
    - Ngày: ISO `YYYY-MM-DD` (khuyến nghị) hoặc `DD/MM/YYYY`; file trộn định dạng bị từ chối (400).
    - Phản hồi luôn có `inserted`, `updated`, `rejected`.

    Role: Warehouse Manager, Admin.
    """
    store_id = (store_id or "").strip()
    if not store_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="store_id không được để trống")
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Hệ thống chỉ chấp nhận định dạng file .csv",
        )

    content = _read_upload_limited(file, request)
    known_items = {row[0] for row in db.query(Product.item_id).all()}

    try:
        clean_df, report = data_preprocessing_service.preprocess_sales_data(
            file_content=content,
            file_name=file.filename,
            default_store_id=store_id,
            known_item_ids=known_items,
            fill_gaps=False,  # Q-02: never invent zeros / never overwrite real sales with 0
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Dữ liệu CSV không hợp lệ: {str(e)}",
        )
    except (pd.errors.ParserError, pd.errors.EmptyDataError, UnicodeDecodeError) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Lỗi khi đọc file CSV: {str(e)}",
        )

    now = datetime.now(timezone.utc)
    import_id = f"imp_{uuid.uuid4().hex[:12]}"
    rejected = int(report.get("rejected_count", 0))
    rejected_rows = report.get("rejected_rows", [])
    inserted = 0
    updated = 0

    if not clean_df.empty:
        clean_df = clean_df.copy()
        clean_df["sale_date"] = pd.to_datetime(clean_df["sale_date"]).dt.date
        dates_in_file = sorted(set(clean_df["sale_date"]))
        items_in_file = sorted(set(clean_df["item_id"]))

        existing_hist = (
            db.query(SalesHistory)
            .filter(
                SalesHistory.store_id == store_id,
                SalesHistory.sale_date >= dates_in_file[0],
                SalesHistory.sale_date <= dates_in_file[-1],
                SalesHistory.item_id.in_(items_in_file),
            )
            .all()
        )
        hist_map = {(h.item_id, h.sale_date): h for h in existing_hist}

        new_rows = []
        for item_id, sale_date, qty in zip(clean_df["item_id"], clean_df["sale_date"], clean_df["sales"]):
            item_id = str(item_id)
            qty = float(qty)
            existing = hist_map.get((item_id, sale_date))
            if existing is not None:
                if float(existing.quantity) != qty:
                    existing.quantity = qty
                updated += 1
            else:
                new_rows.append({
                    "id": f"{item_id}_{store_id}_{sale_date}",
                    "item_id": item_id,
                    "store_id": store_id,
                    "sale_date": sale_date,
                    "quantity": qty,
                })
        if new_rows:
            db.bulk_insert_mappings(SalesHistory, new_rows)
            inserted = len(new_rows)

        # N-23: khởi tạo SimClock và Inventory khi onboarding kho mới (chỉ cho SKU đã có trong danh mục)
        clock = db.query(SimClock).filter(SimClock.store_id == store_id).first()
        if not clock:
            db.add(SimClock(
                store_id=store_id,
                current_date=dates_in_file[0],  # Q-11: clock AT its start; later days can still be simulated
                start_date=dates_in_file[0],
                mode="replay",
                speed=1.0,
            ))
        existing_inv = {
            row[0] for row in db.query(Inventory.item_id).filter(Inventory.store_id == store_id).all()
        }
        for itm in set(items_in_file) - existing_inv:
            db.add(Inventory(item_id=itm, store_id=store_id, on_hand=0.0, on_order=0.0, updated_at=now))

    import_status = "COMPLETED" if (inserted + updated) > 0 else "REJECTED"
    summary = dict(report)
    summary.update({"store_id": store_id, "inserted": inserted, "updated": updated, "rejected": rejected})
    db.add(DataImport(
        id=import_id,
        file_name=file.filename,
        file_type="CSV_SALES",
        row_count=inserted + updated,
        status=import_status,
        uploaded_by=current_user.email,
        summary=summary,
        created_at=now,
    ))
    db.commit()

    if inserted + updated > 0:
        message = (
            f"Đã nạp {inserted + updated} dòng cho kho {store_id} "
            f"({inserted} thêm mới, {updated} cập nhật, {rejected} dòng bị từ chối)."
        )
    else:
        message = f"Không có dòng hợp lệ nào được nạp cho kho {store_id} ({rejected} dòng bị từ chối)."

    return {
        "success": inserted + updated > 0,
        "import_id": import_id,
        "store_id": store_id,
        "file_name": file.filename,
        "rows_cleaned": len(clean_df),
        "inserted": inserted,
        "updated": updated,
        "rejected": rejected,
        "rejected_rows": rejected_rows,
        "imported_count": inserted + updated,
        "skipped_count": rejected,
        "quality_report": report,
        "message": message,
    }


@router.get(
    "/imports/template",
    summary="N-23 - Mô tả template CSV import (cột, kiểu, ví dụ) dùng chung cho FE và BE",
)
def get_import_template_spec(
    format: str = Query("json", pattern="^(json|csv)$", description="json: mô tả cột; csv: tải file mẫu"),
    current_user: User = Depends(get_current_user),
):
    """
    Nguồn DUY NHẤT về cấu trúc file import: tên cột chuẩn, cột bắt buộc, kiểu dữ liệu, ví dụ, định dạng ngày
    và giới hạn kích thước. `?format=csv` trả về chính file mẫu (giống `GET /data/template`).
    """
    if format == "csv":
        return Response(
            content=_template_csv(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=template_store_import.csv"},
        )
    return {
        "file_name": "template_store_import.csv",
        "columns": TEMPLATE_COLUMNS,
        "header": [c["name"] for c in TEMPLATE_COLUMNS],
        "required": [c["name"] for c in TEMPLATE_COLUMNS if c["required"]],
        "date_formats": ["YYYY-MM-DD", "DD/MM/YYYY"],
        "delimiter": ",",
        "encoding": "utf-8",
        "max_file_size_mb": MAX_IMPORT_BYTES // (1024 * 1024),
        "upload_endpoint": "POST /api/v1/imports?store_id=<store>",
        "download_url": "/api/v1/imports/template?format=csv",
        "notes": [
            "Mọi dòng được ghi cho kho truyền ở tham số store_id; dòng có store_id khác bị từ chối.",
            "SKU chưa có trong danh mục sản phẩm bị từ chối (không tự tạo sản phẩm).",
            "Một file chỉ dùng một định dạng ngày.",
        ],
    }


@router.get(
    "/data/template",
    summary="Task API.2 - Tải file CSV mẫu nạp dữ liệu kho hàng (template_store_import.csv)",
)
def download_import_template(
    current_user: User = Depends(get_current_user),
):
    """
    **Task API.2 - Get Import Template**:
    Tải file CSV template chuẩn (cột: item_id, store_id, sale_date, quantity, sell_price).
    """
    return Response(
        content=_template_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=template_store_import.csv"},
    )


@router.post(
    "/forecast/fast-inference",
    response_model=FastInferenceResponse,
    summary="Task API.2 - Kích hoạt dự báo nhanh CPU (SBA) cho kho mới",
)
def run_fast_inference(
    body: FastInferenceRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_manager_or_admin),
):
    """
    **Task API.2 - Fast Inference**:
    Chạy suy luận CPU bằng thuật toán SBA (Syntetos-Boylan Approximation) kết hợp seasonal profile
    theo ngày trong tuần, sinh `horizon` ngày tương lai (h=1..horizon) kèm p10, p50, p90.
    Kết quả được ghi vào bảng `forecast` với `model_version = "fast-inference-sba"`; lần chạy sau
    thay thế nguyên tử lần chạy trước của cùng kho.
    """
    start_time = time.time()
    store_id = body.store_id
    horizon = body.horizon

    sales = (
        db.query(SalesHistory.item_id, SalesHistory.sale_date, SalesHistory.quantity)
        .filter(SalesHistory.store_id == store_id)
        .order_by(SalesHistory.sale_date.asc())
        .all()
    )
    if not sales:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy dữ liệu bán hàng cho kho '{store_id}'. Hãy tải file CSV lên trước.",
        )

    df_sales = pd.DataFrame(sales, columns=["item_id", "sale_date", "sales"])
    df_sales["store_id"] = store_id
    df_sales["sales"] = df_sales["sales"].astype(float)
    # P-07: service cần cột datetime (dùng .dt.dayofweek); DB trả về datetime.date
    df_sales["sale_date"] = pd.to_datetime(df_sales["sale_date"])

    forecast_df = fast_inference_service.generate_fast_forecast(
        df_sales, horizon=horizon, model_version=FAST_INFERENCE_MODEL_VERSION
    )

    records_saved = 0
    skus_forecasted = 0
    if not forecast_df.empty:
        now = datetime.now(timezone.utc)
        forecast_df = forecast_df.copy()
        forecast_df["id"] = (
            "fast_" + store_id + "_" + forecast_df["item_id"].astype(str)
            + "_" + forecast_df["forecast_date"].astype(str) + "_" + forecast_df["h"].astype(str)
        )
        forecast_df["generated_at"] = now
        columns = [
            "id", "item_id", "store_id", "forecast_date", "h", "y_pred",
            "p10", "p50", "p90", "available", "model_version", "generated_at",
        ]
        # Xóa lần chạy trước + nạp lần mới trong CÙNG transaction của session (R-34)
        records_saved = replace_rows(
            db.connection(),
            "forecast",
            forecast_df[columns],
            "DELETE FROM forecast WHERE store_id = :s AND model_version = :m",
            {"s": store_id, "m": FAST_INFERENCE_MODEL_VERSION},
        )
        skus_forecasted = int(forecast_df["item_id"].nunique())
    db.commit()

    duration = round(time.time() - start_time, 3)
    return FastInferenceResponse(
        success=True,
        store_id=store_id,
        horizon=horizon,
        skus_forecasted=skus_forecasted,
        records_generated=records_saved,
        duration_seconds=duration,
        message=f"Đã hoàn thành dự báo SBA cho {skus_forecasted} SKU ({records_saved} bản ghi) trong {duration}s.",
    )
