from typing import List, Optional
from fastapi import APIRouter, Depends, Query, Request, BackgroundTasks
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user, require_manager_or_admin
from app.models.user import User
from app.schemas.inventory import (
    InventoryUpdate,
    InventoryResponse,
    InventoryListResponse,
    InventoryAdjustmentListResponse,
)
from app.services.inventory_service import inventory_service

router = APIRouter()


def get_client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


@router.get("", response_model=InventoryListResponse, summary="UC13 - Danh sách tồn kho theo SKU và Cửa hàng")
def list_inventory(
    skip: int = Query(0, ge=0, description="Số lượng bản ghi bỏ qua (phân trang)"),
    limit: int = Query(50, ge=1, le=500, description="Số lượng bản ghi tối đa lấy về"),
    store_id: Optional[str] = Query(None, description="Lọc theo mã cửa hàng/kho (ví dụ: CA_1)"),
    item_id: Optional[str] = Query(None, description="Lọc theo mã SKU sản phẩm"),
    search: Optional[str] = Query(None, description="Tìm kiếm theo mã SKU hoặc tên sản phẩm"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    **UC13 - List Inventory**:
    Xem số lượng tồn kho thực tế (on-hand) và hàng đang về (on-order) của từng SKU theo từng kho/cửa hàng.
    """
    return inventory_service.list_inventory(
        db, skip=skip, limit=limit, store_id=store_id, item_id=item_id, search=search
    )


@router.get("/stores", response_model=List[str], summary="UC13 - Danh sách mã kho / Cửa hàng")
def get_stores(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return inventory_service.get_stores(db)


@router.get("/history", response_model=InventoryAdjustmentListResponse, summary="UC14 - Nhật ký điều chỉnh tồn kho (Manager & Admin)")
def list_adjustment_history(
    skip: int = Query(0, ge=0, description="Số lượng bản ghi bỏ qua (phân trang)"),
    limit: int = Query(50, ge=1, le=500, description="Số lượng bản ghi tối đa lấy về"),
    item_id: Optional[str] = Query(None, description="Lọc theo mã SKU sản phẩm"),
    store_id: Optional[str] = Query(None, description="Lọc theo mã cửa hàng/kho"),
    adjusted_by: Optional[str] = Query(None, description="Lọc theo email người thực hiện"),
    db: Session = Depends(get_db),
    user: User = Depends(require_manager_or_admin),
):
    """
    **UC14 - View Inventory Adjustment History**:
    Xem nhật ký các lần điều chỉnh số liệu tồn kho (số lượng cũ, số lượng mới, lý do điều chỉnh, người thực hiện).
    """
    return inventory_service.list_adjustments(
        db, skip=skip, limit=limit, item_id=item_id, store_id=store_id, adjusted_by=adjusted_by
    )


@router.get("/{item_id}/{store_id}", response_model=InventoryResponse, summary="UC13 - Chi tiết tồn kho SKU tại kho cụ thể")
def get_inventory(
    item_id: str,
    store_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return inventory_service.get_inventory(db, item_id=item_id, store_id=store_id)


@router.put("/{item_id}/{store_id}", response_model=InventoryResponse, summary="UC13 - Cập nhật tồn kho On-hand & On-order (Manager & Admin)")
def update_inventory(
    item_id: str,
    store_id: str,
    req_body: InventoryUpdate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_manager_or_admin),
):
    """
    **UC13 - Update On-hand & On-order Inventory**:
    Thủ kho hoặc Admin cập nhật số lượng tồn kho thực tế và hàng đang về sau kiểm kê.
    Hệ thống tự động phát tín hiệu Realtime SSE (`inventory.updated`) và ghi nhận lịch sử điều chỉnh (UC14).
    """
    ip = get_client_ip(request)
    return inventory_service.update_inventory(
        db,
        item_id=item_id,
        store_id=store_id,
        request=req_body,
        background_tasks=background_tasks,
        user_email=user.email,
        ip_address=ip,
    )
