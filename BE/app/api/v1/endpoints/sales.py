from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, Query, Request, UploadFile, File, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user, require_admin
from app.models.user import User
from app.schemas.sales import (
    SaleRecordCreate,
    SaleRecordResponse,
    SalesQueryResponse,
    SalesSummaryResponse,
    SalesImportResponse,
)
from app.services.sales_service import sales_service

router = APIRouter()


def get_client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


@router.get("", response_model=SalesQueryResponse, summary="UC15 / UC20 - Tra cứu dữ liệu bán hàng lịch sử")
def query_sales(
    skip: int = Query(0, ge=0, description="Số lượng bản ghi bỏ qua (phân trang)"),
    limit: int = Query(50, ge=1, le=500, description="Số lượng bản ghi tối đa lấy về"),
    item_id: Optional[str] = Query(None, description="Lọc theo mã SKU sản phẩm"),
    store_id: Optional[str] = Query(None, description="Lọc theo mã cửa hàng / kho"),
    start_date: Optional[date] = Query(None, description="Ngày bắt đầu (YYYY-MM-DD)"),
    end_date: Optional[date] = Query(None, description="Ngày kết thúc (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    **UC15 / UC20 - Historical Sales Data**:
    Tra cứu sản lượng bán hàng lịch sử theo SKU, cửa hàng và khung thời gian.
    Trả về danh sách bản ghi kèm tổng sản lượng (`total_quantity`) và trung bình (`average_quantity`).
    """
    return sales_service.query_sales(
        db,
        skip=skip,
        limit=limit,
        item_id=item_id,
        store_id=store_id,
        start_date=start_date,
        end_date=end_date,
    )


@router.get("/summary", response_model=SalesSummaryResponse, summary="UC15 - Thống kê tổng quan dữ liệu bán hàng")
def get_sales_summary(
    item_id: Optional[str] = Query(None, description="Lọc theo mã SKU"),
    store_id: Optional[str] = Query(None, description="Lọc theo mã cửa hàng"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    **UC15 - Sales Summary**:
    Thống kê tổng số bản ghi, ngày bán sớm nhất, ngày bán muộn nhất và tổng sản lượng bán ra.
    """
    return sales_service.get_summary(db, item_id=item_id, store_id=store_id)


@router.post("", response_model=SaleRecordResponse, status_code=status.HTTP_201_CREATED, summary="UC15 - Thêm bản ghi bán hàng (Admin only)")
def create_sale_record(
    req_body: SaleRecordCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    ip = get_client_ip(request)
    return sales_service.create_sale(
        db, request=req_body, admin_email=admin.email, ip_address=ip
    )


@router.post("/import", response_model=SalesImportResponse, summary="UC15 - Import dữ liệu bán hàng từ file CSV (Admin only)")
def import_sales_csv(
    request: Request,
    file: UploadFile = File(..., description="File CSV chứa dữ liệu bán hàng (cột: item_id, store_id, sale_date, quantity)"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **UC15 - Import Historical Sales Data (CSV)**:
    Admin tải lên file CSV chứa dữ liệu bán hàng lịch sử để hệ thống xác thực và lưu trữ phục vụ huấn luyện mô hình ML.
    """
    ip = get_client_ip(request)
    return sales_service.import_csv_file(
        db, file=file, admin_email=admin.email, ip_address=ip
    )
