from fastapi import APIRouter, BackgroundTasks, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin
from app.models.user import User
from app.schemas.ml_training import (
    TrainJobRequest,
    TrainJobCreateResponse,
    TrainJobResponse,
    TrainJobListResponse,
)
from app.services.ml_training_service import ml_training_service

router = APIRouter()


@router.post(
    "/train",
    response_model=TrainJobCreateResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="UC47 - Huấn luyện & Benchmark các mô hình dự báo (Admin only)",
)
def train_and_benchmark_models(
    request: TrainJobRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **UC47 - Train & Benchmark Forecasting Models**:
    - Khởi tạo tiến trình bất đồng bộ (Background Task) để huấn luyện và so sánh mô hình.
    - Hỗ trợ các mô hình: `lightgbm`, `xgboost`, `baseline_naive`.
    - Trả về mã lỗi 400 rõ ràng nếu chọn các mô hình trong lộ trình tương lai (`arima`, `lstm`, `tft`).
    - Metric đánh giá: MAE, RMSE, MASE, WRMSSE (chuẩn M5 Walmart).
    - Phân chia thời gian (Temporal Split), tích hợp sự kiện từ lịch (UC16).
    """
    return ml_training_service.create_and_start_job(
        db,
        request=request,
        background_tasks=background_tasks,
        admin_email=admin.email,
    )


@router.get(
    "/train/{job_id}",
    response_model=TrainJobResponse,
    summary="UC47 - Tra cứu tiến trình và chỉ số Benchmark của Job (Admin only)",
)
def get_training_job_status(
    job_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    Tra cứu trạng thái (`pending`, `running`, `done`, `failed`) và bộ metrics đánh giá của Job theo `job_id`.
    """
    return ml_training_service.get_job(db, job_id=job_id)


@router.get(
    "/train",
    response_model=TrainJobListResponse,
    summary="UC47 - Danh sách lịch sử các phiên huấn luyện mô hình (Admin only)",
)
def list_training_jobs(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    Lấy danh sách lịch sử các phiên huấn luyện có phân trang.
    """
    return ml_training_service.list_jobs(db, skip=skip, limit=limit)
