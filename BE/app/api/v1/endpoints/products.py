from typing import List, Optional
from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user, require_admin
from app.models.user import User
from app.schemas.product import (
    ProductCreate,
    ProductUpdate,
    ProductResponse,
    ProductListResponse,
    ProductBulkCreateRequest,
    ProductBulkCreateResponse,
)
from app.services.product_service import product_service

router = APIRouter()


def get_client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


@router.get("", response_model=ProductListResponse, summary="UC11 - Danh sách sản phẩm (SKU Master Data)")
def list_products(
    skip: int = Query(0, ge=0, description="Số lượng bản ghi bỏ qua (phân trang)"),
    limit: int = Query(50, ge=1, le=500, description="Số lượng bản ghi tối đa lấy về"),
    search: Optional[str] = Query(None, description="Tìm kiếm theo mã SKU hoặc tên sản phẩm"),
    dept_id: Optional[str] = Query(None, description="Lọc theo mã ngành hàng (Department)"),
    cat_id: Optional[str] = Query(None, description="Lọc theo mã phân loại (Category)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    **UC11 - List Products**:
    Xem danh sách danh mục sản phẩm (SKU) kèm bộ lọc theo ngành hàng, phân loại và từ khóa tìm kiếm.
    """
    return product_service.list_products(
        db, skip=skip, limit=limit, search=search, dept_id=dept_id, cat_id=cat_id
    )


@router.get("/categories", response_model=List[str], summary="UC11 - Danh sách danh mục sản phẩm (Categories)")
def get_categories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return product_service.get_categories(db)


@router.get("/departments", response_model=List[str], summary="UC11 - Danh sách ngành hàng (Departments)")
def get_departments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return product_service.get_departments(db)


@router.get("/{item_id}", response_model=ProductResponse, summary="UC11 - Xem chi tiết sản phẩm theo SKU")
def get_product(
    item_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return product_service.get_product(db, item_id)


@router.post("", response_model=ProductResponse, status_code=status.HTTP_201_CREATED, summary="UC11 - Thêm mới sản phẩm (Admin only)")
def create_product(
    req_body: ProductCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    ip = get_client_ip(request)
    return product_service.create_product(
        db, request=req_body, admin_email=admin.email, ip_address=ip
    )


@router.put("/{item_id}", response_model=ProductResponse, summary="UC11 - Cập nhật thông tin sản phẩm (Admin only)")
def update_product(
    item_id: str,
    req_body: ProductUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    ip = get_client_ip(request)
    return product_service.update_product(
        db, item_id=item_id, request=req_body, admin_email=admin.email, ip_address=ip
    )


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT, summary="UC11 - Xóa sản phẩm (Admin only)")
def delete_product(
    item_id: str,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    ip = get_client_ip(request)
    product_service.delete_product(
        db, item_id=item_id, admin_email=admin.email, ip_address=ip
    )
    return None


@router.post("/bulk", response_model=ProductBulkCreateResponse, summary="UC11 - Import hàng loạt sản phẩm (Admin only)")
def bulk_create_products(
    req_body: ProductBulkCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    ip = get_client_ip(request)
    return product_service.bulk_create(
        db, request=req_body, admin_email=admin.email, ip_address=ip
    )
