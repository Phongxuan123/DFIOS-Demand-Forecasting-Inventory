from typing import Optional
from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user, require_admin
from app.models.user import User
from app.schemas.supplier import (
    SupplierCreate,
    SupplierUpdate,
    SupplierResponse,
    SupplierListResponse,
)
from app.services.supplier_service import supplier_service

router = APIRouter()


def get_client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


@router.get("", response_model=SupplierListResponse, summary="UC12 - Danh sách nhà cung cấp & Lead Time")
def list_suppliers(
    skip: int = Query(0, ge=0, description="Số lượng bản ghi bỏ qua (phân trang)"),
    limit: int = Query(50, ge=1, le=500, description="Số lượng bản ghi tối đa lấy về"),
    search: Optional[str] = Query(None, description="Tìm kiếm theo mã hoặc tên nhà cung cấp"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    **UC12 - List Suppliers**:
    Xem danh sách nhà cung cấp và thời gian giao hàng (Lead Time).
    """
    return supplier_service.list_suppliers(db, skip=skip, limit=limit, search=search)


@router.get("/{id}", response_model=SupplierResponse, summary="UC12 - Chi tiết nhà cung cấp")
def get_supplier(
    id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return supplier_service.get_supplier(db, id)


@router.post("", response_model=SupplierResponse, status_code=status.HTTP_201_CREATED, summary="UC12 - Thêm nhà cung cấp (Admin only)")
def create_supplier(
    req_body: SupplierCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    ip = get_client_ip(request)
    return supplier_service.create_supplier(
        db, request=req_body, admin_email=admin.email, ip_address=ip
    )


@router.put("/{id}", response_model=SupplierResponse, summary="UC12 - Cập nhật nhà cung cấp & Lead Time (Admin only)")
def update_supplier(
    id: str,
    req_body: SupplierUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    ip = get_client_ip(request)
    return supplier_service.update_supplier(
        db, id=id, request=req_body, admin_email=admin.email, ip_address=ip
    )


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT, summary="UC12 - Xóa nhà cung cấp (Admin only)")
def delete_supplier(
    id: str,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    ip = get_client_ip(request)
    supplier_service.delete_supplier(
        db, id=id, admin_email=admin.email, ip_address=ip
    )
    return None
