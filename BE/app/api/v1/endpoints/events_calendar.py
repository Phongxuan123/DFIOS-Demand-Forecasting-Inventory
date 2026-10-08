from datetime import date
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user, require_admin
from app.models.user import User
from app.schemas.event_calendar import (
    EventCreate,
    EventUpdate,
    EventResponse,
    EventListResponse,
    EventBulkCreateRequest,
    EventBulkCreateResponse,
)
from app.services.event_calendar_service import event_calendar_service

router = APIRouter()


def get_client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


@router.get("", response_model=EventListResponse, summary="UC16 - Lịch sự kiện & Khuyến mãi (Event Calendar)")
def list_events(
    skip: int = Query(0, ge=0, description="Số lượng bản ghi bỏ qua (phân trang)"),
    limit: int = Query(50, ge=1, le=500, description="Số lượng bản ghi tối đa lấy về"),
    event_type: Optional[str] = Query(None, description="Lọc theo loại sự kiện (Sporting, Cultural, National, Religious, Promotion)"),
    start_date: Optional[date] = Query(None, description="Ngày bắt đầu (YYYY-MM-DD)"),
    end_date: Optional[date] = Query(None, description="Ngày kết thúc (YYYY-MM-DD)"),
    search: Optional[str] = Query(None, description="Tìm kiếm theo tên sự kiện"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    **UC16 - Manage Event / Promotion Calendar**:
    Xem danh sách sự kiện, ngày lễ và chương trình khuyến mãi (covariates đầu vào cho mô hình dự báo).
    """
    return event_calendar_service.list_events(
        db,
        skip=skip,
        limit=limit,
        event_type=event_type,
        start_date=start_date,
        end_date=end_date,
        search=search,
    )


@router.get("/types", response_model=List[str], summary="UC16 - Danh sách các loại sự kiện (Event Types)")
def get_event_types(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return event_calendar_service.get_event_types(db)


@router.get("/{id}", response_model=EventResponse, summary="UC16 - Chi tiết sự kiện")
def get_event(
    id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return event_calendar_service.get_event(db, id)


@router.post("", response_model=EventResponse, status_code=status.HTTP_201_CREATED, summary="UC16 - Thêm sự kiện mới (Admin only)")
def create_event(
    req_body: EventCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    ip = get_client_ip(request)
    return event_calendar_service.create_event(
        db, request=req_body, admin_email=admin.email, ip_address=ip
    )


@router.put("/{id}", response_model=EventResponse, summary="UC16 - Cập nhật sự kiện (Admin only)")
def update_event(
    id: str,
    req_body: EventUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    ip = get_client_ip(request)
    return event_calendar_service.update_event(
        db, id=id, request=req_body, admin_email=admin.email, ip_address=ip
    )


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT, summary="UC16 - Xóa sự kiện (Admin only)")
def delete_event(
    id: str,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    ip = get_client_ip(request)
    event_calendar_service.delete_event(
        db, id=id, admin_email=admin.email, ip_address=ip
    )
    return None


@router.post("/bulk", response_model=EventBulkCreateResponse, summary="UC16 - Import hàng loạt sự kiện (Admin only)")
def bulk_create_events(
    req_body: EventBulkCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    ip = get_client_ip(request)
    return event_calendar_service.bulk_create_events(
        db, request=req_body, admin_email=admin.email, ip_address=ip
    )
