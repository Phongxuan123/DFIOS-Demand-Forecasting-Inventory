from typing import Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin
from app.models.user import User
from app.schemas.model_registry import (
    ModelRegisterRequest,
    ModelRegistryResponse,
    ModelPromoteResponse,
    ModelRegistryListResponse,
)
from app.services.model_registry_service import model_registry_service

router = APIRouter()


@router.get(
    "/models",
    response_model=ModelRegistryListResponse,
    summary="UC48 - Danh sách các phiên bản mô hình trong Model Registry (Admin only)",
)
def list_registered_models(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    is_production: Optional[bool] = Query(None, description="Lọc theo trạng thái production"),
    algorithm: Optional[str] = Query(None, description="Lọc theo thuật toán (lightgbm, xgboost...)"),
    scope: Optional[str] = Query(None, description="Lọc theo phạm vi (global, mã kho/SKU)"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **UC48 - Manage Model Registry**:
    Liệt kê danh sách các phiên bản mô hình kèm siêu tham số, chỉ số đánh giá (MAE, RMSE, WRMSSE) và trạng thái Production.
    """
    return model_registry_service.list_models(
        db,
        skip=skip,
        limit=limit,
        is_production=is_production,
        algorithm=algorithm,
        scope=scope,
    )


@router.get(
    "/models/{model_id}",
    response_model=ModelRegistryResponse,
    summary="UC48 - Xem chi tiết phiên bản mô hình (Admin only)",
)
def get_registered_model(
    model_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    Xem chi tiết thông tin và tham số của một phiên bản mô hình theo `model_id`.
    """
    return model_registry_service.get_model(db, model_id=model_id)


@router.post(
    "/models/{model_id}/promote",
    response_model=ModelPromoteResponse,
    summary="UC48 - Thăng hạng mô hình làm bản Production (Admin only)",
)
def promote_model_to_production(
    model_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **UC48 - Promote Model to Production**:
    - Đánh dấu phiên bản mô hình được chọn thành bản **Production** cho phạm vi (`scope`) tương ứng.
    - Tự động hạ cấp phiên bản Production cũ cùng scope (mỗi scope/SKU chỉ duy nhất 1 bản Production).
    - Ghi nhận nhật ký kiểm toán (Audit Log).
    """
    return model_registry_service.promote_model(
        db, model_id=model_id, admin_email=admin.email
    )


@router.post(
    "/models",
    response_model=ModelRegistryResponse,
    status_code=status.HTTP_201_CREATED,
    summary="UC48 - Đăng ký phiên bản mô hình mới vào Registry (Admin only)",
)
def register_new_model(
    request: ModelRegisterRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    Đăng ký một phiên bản mô hình vào Model Registry.
    """
    return model_registry_service.register_model(
        db, request=request, admin_email=admin.email
    )
