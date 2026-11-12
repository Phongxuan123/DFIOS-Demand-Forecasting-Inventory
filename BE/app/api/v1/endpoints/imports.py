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
async def upload_store_data(
    file: UploadFile = File(..., description="File CSV dữ liệu bán hàng"),
    store_id: str = Query("CA_1", description="Mã kho hàng/cửa hàng"),
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
    if not file.filename.endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Hệ thống chỉ chấp nhận định dạng file .csv",
        )

    content = await file.read()
    clean_df, report = data_preprocessing_service.preprocess_sales_data(
        file_content=content,
        file_name=file.filename,
        default_store_id=store_id,
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

    # Nạp dữ liệu sạch vào bảng sales_history
    if not clean_df.empty:
        for _, row in clean_df.iterrows():
            item_id = str(row["item_id"])
            s_id = str(row.get("store_id", store_id))
            sale_date = pd.to_datetime(row["sale_date"]).date()
            qty = float(row.get("sales", 0.0))

            hist_id = f"{item_id}_{s_id}_{sale_date}"
            existing = db.query(SalesHistory).filter(SalesHistory.id == hist_id).first()
            if existing:
                existing.quantity = qty
            else:
                db.add(
                    SalesHistory(
                        id=hist_id,
                        item_id=item_id,
                        store_id=s_id,
                        sale_date=sale_date,
                        quantity=qty,
                    )
                )

    db.commit()

    return {
        "success": True,
        "import_id": import_id,
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
    Tải file CSV template chuẩn (cột: sale_date, store_id, item_id, sales, price).
    """
    if os.path.exists(TEMPLATE_PATH):
        with open(TEMPLATE_PATH, "r", encoding="utf-8") as f:
            csv_content = f.read()
    else:
        csv_content = "sale_date,store_id,item_id,sales,price\n2026-01-01,CA_1,FOODS_1_001,15,2.50\n"

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
