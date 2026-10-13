from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin
from app.models.user import User
from app.schemas.data_quality import (
    DataQualityRunRequest,
    DataQualityRunResponse,
    DataQualityRunListResponse,
)
from app.services.data_quality_service import data_quality_service

router = APIRouter()


@router.post(
    "/data-quality/run",
    response_model=DataQualityRunResponse,
    status_code=status.HTTP_201_CREATED,
    summary="UC46 - Chạy kiểm tra chất lượng dữ liệu & chống rò rỉ (Admin only)",
)
def run_data_quality_check(
    request: DataQualityRunRequest = DataQualityRunRequest(),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **UC46 - Data Quality Check & Leakage Prevention**:
    - Kiểm tra tính nhất quán: số lượng bán âm, trùng lặp ngày, SKU không tồn tại trong danh mục.
    - Phát hiện ngoại lai (Outliers) theo Z-score.
    - Kiểm tra khoảng trống / tỷ lệ thiếu ngày bán hàng (Missing Values).
    - Kiểm tra rò rỉ dữ liệu (Data Leakage): Phát hiện bản ghi sau mốc `cutoff_date`.
    - Phân quyền: Chỉ `Admin` có quyền kích hoạt.
    """
    return data_quality_service.run_check(db, request=request, admin_email=admin.email)


@router.get(
    "/data-quality/{run_id}",
    response_model=DataQualityRunResponse,
    summary="UC46 - Tra cứu chi tiết kết quả kiểm tra chất lượng dữ liệu (Admin only)",
)
def get_data_quality_run(
    run_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    Tra cứu chi tiết kết quả một lượt kiểm tra chất lượng dữ liệu theo `run_id`.
    """
    return data_quality_service.get_run(db, run_id=run_id)


@router.get(
    "/data-quality",
    response_model=DataQualityRunListResponse,
    summary="UC46 - Danh sách các lượt kiểm tra chất lượng dữ liệu (Admin only)",
)
def list_data_quality_runs(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    Lấy danh sách lịch sử các lượt kiểm tra chất lượng dữ liệu có phân trang.
    """
    return data_quality_service.list_runs(db, skip=skip, limit=limit)
