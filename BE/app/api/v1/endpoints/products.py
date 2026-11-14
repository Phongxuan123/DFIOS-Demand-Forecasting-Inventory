from typing import List, Optional
from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user, require_admin, get_client_ip
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


@router.get("", response_model=ProductListResponse, summary="UC11 - Danh sách sản phẩm (SKU Master Data)")
def list_products(
    skip: int = Query(0, ge=0, description="Số lượng bản ghi bỏ qua (phân trang)"),
    limit: int = Query(50, ge=1, le=500, description="Số lượng bản ghi tối đa lấy về"),
    search: Optional[str] = Query(None, description="Tìm kiếm theo mã SKU hoặc tên sản phẩm"),
    dept_id: Optional[str] = Query(None, description="Lọc theo mã ngành hàng (Department)"),
    cat_id: Optional[str] = Query(None, description="Lọc theo mã phân loại (Category)"),
    page: Optional[int] = Query(None, ge=1, description="R-35: số trang (từ 1). Nếu có cùng page_size thì thay cho skip/limit"),
    page_size: Optional[int] = Query(None, ge=1, le=500, description="R-35: số bản ghi mỗi trang"),
    q: Optional[str] = Query(None, description="R-35: alias của `search`"),
    sort_by: Optional[str] = Query(None, pattern="^(item_id|name|dept_id|cat_id|price)$", description="R-35: cột sắp xếp"),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$", description="R-35: chiều sắp xếp"),
    store_id: Optional[str] = Query(None, description="Cửa hàng cho on_hand / s / S theo hàng (bỏ trống = gộp mọi cửa hàng)"),
    response: Response = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    **UC11 - List Products**:
    Xem danh sách danh mục sản phẩm (SKU) kèm bộ lọc theo ngành hàng, phân loại và từ khóa tìm kiếm.
    Phân trang/lọc/sắp xếp ở server (R-35). Dạng cũ `skip`/`limit`/`search` vẫn dùng được; tổng số bản ghi
    nằm ở `total` và header `X-Total-Count`.
    """
    if page is not None:
        limit = page_size or limit
        skip = (page - 1) * limit
    result = product_service.list_products(
        db, skip=skip, limit=limit, search=q or search, dept_id=dept_id, cat_id=cat_id,
        sort_by=sort_by, sort_dir=sort_dir, store_id=store_id,
    )
    if response is not None:
        response.headers["X-Total-Count"] = str(result.total)
    return result


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
