import io
import os
import time
import uuid
import pandas as pd
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, UploadFile, File, Query, Response, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_manager_or_admin, get_current_user
from app.models.user import User
from app.models.data_imports import DataImport
from app.models.sales_history import SalesHistory
from app.models.forecast import Forecast
from app.models.product import Product
from app.schemas.data_import import DataImportResponse, FastInferenceRequest, FastInferenceResponse
from app.services.data_preprocessing_service import data_preprocessing_service
from app.services.fast_inference_service import fast_inference_service

router = APIRouter()

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_PATH = os.path.join(SCRIPT_DIR, "../../../scripts/sample_data/template_store_import.csv")


@router.post(
    "/imports",
    summary="Task API.2 - Tải lên CSV kho hàng mới và trả về báo cáo chất lượng dữ liệu (Data Quality Report)",
)
def upload_store_data(
    file: UploadFile = File(..., description="File CSV dữ liệu bán hàng"),
    store_id: str = Query(..., description="Mã kho hàng/cửa hàng (bắt buộc chỉ định mã kho cụ thể)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    **Task API.2 - Import Store CSV**:
    Tải lên file CSV bán lẻ (hỗ trợ cả tiếng Việt và tiếng Anh).
    Tự động chuẩn hóa schema, resampling chuỗi thời gian liên tục, điền zero-sales,
    và xuất Data Quality Report đầy đủ (tỷ lệ missing, zero-rate, số SKU, dải ngày).
    Role: Warehouse Manager, Admin.
    """
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Hệ thống chỉ chấp nhận định dạng file .csv",
        )

    content = file.file.read()
    max_file_size = 50 * 1024 * 1024  # 50MB
    if len(content) > max_file_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Kích thước file ({len(content)/(1024*1024):.1f}MB) vượt quá giới hạn tối đa cho phép (50MB).",
        )

    try:
        clean_df, report = data_preprocessing_service.preprocess_sales_data(
            file_content=content,
            file_name=file.filename,
            default_store_id=store_id,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Dữ liệu CSV không hợp lệ: {str(e)}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Lỗi khi đọc file CSV: {str(e)}",
        )

    now = datetime.now(timezone.utc)
    import_id = f"imp_{uuid.uuid4().hex[:12]}"

    # Lưu nhật ký vào bảng data_imports
    record = DataImport(
        id=import_id,
        file_name=file.filename,
        file_type="CSV_SALES",
        row_count=len(clean_df),
        status="COMPLETED",
        uploaded_by=current_user.email,
        summary=report,
        created_at=now,
    )
    db.add(record)

    # Nạp dữ liệu sạch vào bảng sales_history (bulk mapped để tối ưu hiệu năng)
    if not clean_df.empty:
        existing_products = {p.item_id for p in db.query(Product.item_id).all()}
        new_items = set(clean_df["item_id"]) - existing_products
        for item_id in new_items:
            db.add(Product(item_id=item_id, name=item_id, cat_id="OTHER", dept_id="OTHER_1", price=1.0))
        if new_items:
            db.flush()

        dates_in_file = [pd.to_datetime(d).date() for d in clean_df["sale_date"].unique()]
        existing_hist = (
            db.query(SalesHistory)
            .filter(
                SalesHistory.store_id == store_id,
                SalesHistory.sale_date.in_(dates_in_file),
            )
            .all()
        )
        hist_map = {h.id: h for h in existing_hist}

        for _, row in clean_df.iterrows():
            item_id = str(row["item_id"])
            s_id = str(row.get("store_id", store_id))
            sale_date = pd.to_datetime(row["sale_date"]).date()
            qty = float(row.get("sales", 0.0))

            hist_id = f"{item_id}_{s_id}_{sale_date}"
            existing = hist_map.get(hist_id)
            if existing:
                existing.quantity = qty
            else:
                new_h = SalesHistory(
                    id=hist_id,
                    item_id=item_id,
                    store_id=s_id,
                    sale_date=sale_date,
                    quantity=qty,
                )
                db.add(new_h)
                hist_map[hist_id] = new_h

        # N-23: Tự động khởi tạo SimClock và Inventory khi onboarding kho mới qua /imports
        from app.models.sim_clock import SimClock
        from app.models.inventory import Inventory
        clock = db.query(SimClock).filter(SimClock.store_id == store_id).first()
        if not clock:
            dates = [pd.to_datetime(d).date() for d in clean_df["sale_date"].unique()]
            max_d = max(dates)
            min_d = min(dates)
            db.add(SimClock(store_id=store_id, current_date=max_d, start_date=min_d, mode="replay", speed=1.0))
        existing_inv = set(
            inv[0] for inv in db.query(Inventory.item_id).filter(Inventory.store_id == store_id).all()
        )
        for itm in set(clean_df["item_id"]) - existing_inv:
            db.add(Inventory(item_id=itm, store_id=store_id, on_hand=0.0, on_order=0.0, updated_at=now))

    db.commit()

    return {
        "success": True,
        "import_id": import_id,
        "store_id": store_id,
        "file_name": file.filename,
        "rows_cleaned": len(clean_df),
        "quality_report": report,
        "message": f"Chuẩn hóa thành công {len(clean_df)} dòng dữ liệu cho kho {store_id}.",
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
    if os.path.exists(TEMPLATE_PATH):
        with open(TEMPLATE_PATH, "r", encoding="utf-8") as f:
            csv_content = f.read()
    else:
        csv_content = "item_id,store_id,sale_date,quantity,sell_price\nFOODS_1_001,STORE_01,2026-01-01,15,2.50\n"

    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=template_store_import.csv"},
    )


@router.post(
    "/forecast/fast-inference",
    response_model=FastInferenceResponse,
    summary="Task API.2 - Kích hoạt dự báo nhanh CPU (SBA) cho kho mới trong 1 giây",
)
def run_fast_inference(
    body: FastInferenceRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_manager_or_admin),
):
    """
    **Task API.2 - Fast Inference**:
    Chạy suy luận CPU cực nhanh bằng thuật toán SBA (Syntetos-Boylan Approximation)
    kết hợp seasonal profile theo ngày trong tuần, sinh 28 ngày tương lai (h=1..28)
    kèm khoảng tin cậy p10, p50, p90 trong dưới 1 giây.
    """
    start_time = time.time()
    store_id = body.store_id
    horizon = body.horizon

    # Lấy dữ liệu bán hàng của kho
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

    df_sales = pd.DataFrame(
        [{"item_id": s[0], "sale_date": s[1], "sales": float(s[2]), "store_id": store_id} for s in sales]
    )

    forecast_df = fast_inference_service.fast_forecast(df_sales, horizon=horizon)

    now = datetime.now(timezone.utc)
    records_saved = 0
    skus_set = set()

    for _, row in forecast_df.iterrows():
        item_id = str(row["item_id"])
        h_val = int(row["h"])
        fc_date = pd.to_datetime(row["forecast_date"]).date()
        rec_id = f"fast_{store_id}_{item_id}_{fc_date}_{h_val}"
        skus_set.add(item_id)

        existing = db.query(Forecast).filter(Forecast.id == rec_id).first()
        if existing:
            existing.y_pred = float(row["y_pred"])
            existing.p10 = float(row["p10"])
            existing.p50 = float(row["p50"])
            existing.p90 = float(row["p90"])
            existing.available = True
            existing.generated_at = now
        else:
            db.add(
                Forecast(
                    id=rec_id,
                    item_id=item_id,
                    store_id=store_id,
                    forecast_date=fc_date,
                    h=h_val,
                    y_pred=float(row["y_pred"]),
                    p10=float(row["p10"]),
                    p50=float(row["p50"]),
                    p90=float(row["p90"]),
                    available=True,
                    model_version="fast-inference-sba",
                    generated_at=now,
                )
            )
        records_saved += 1

    db.commit()
    duration = round(time.time() - start_time, 3)

    return FastInferenceResponse(
        success=True,
        store_id=store_id,
        horizon=horizon,
        skus_forecasted=len(skus_set),
        records_generated=records_saved,
        duration_seconds=duration,
        message=f"Đã hoàn thành dự báo SBA cho {len(skus_set)} SKU ({records_saved} bản ghi) trong {duration}s.",
    )
