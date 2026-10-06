from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin
from app.models.user import User
from app.schemas.audit_log import AuditLogResponse, AuditLogListResponse
from app.services.audit_service import audit_service

router = APIRouter()


@router.get(
    "",
    response_model=AuditLogListResponse,
    summary="UC45 - Xem và lọc nhật ký hoạt động (Admin only)",
)
def list_audit_logs(
    skip: int = Query(0, ge=0, description="Số bản ghi bỏ qua (phân trang)"),
    limit: int = Query(50, ge=1, le=500, description="Số bản ghi tối đa trả về"),
    action: Optional[str] = Query(None, description="Lọc theo loại hành động (chứa chuỗi)"),
    actor_email: Optional[str] = Query(None, description="Lọc theo email người thực hiện"),
    start_time: Optional[datetime] = Query(None, description="Thời gian bắt đầu (ISO 8601)"),
    end_time: Optional[datetime] = Query(None, description="Thời gian kết thúc (ISO 8601)"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **UC45 - View Audit Logs (Admin only)**:
    Admin tra cứu và lọc nhật ký hoạt động của người dùng và các thao tác bảo mật theo thời gian, loại hành động và email.
    """
    items, total = audit_service.list_logs(
        db,
        skip=skip,
        limit=limit,
        action=action,
        actor_email=actor_email,
        start_time=start_time,
        end_time=end_time,
    )
    return AuditLogListResponse(
        items=[AuditLogResponse.model_validate(item) for item in items],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get(
    "/actions",
    response_model=List[str],
    summary="UC45 - Danh sách các loại hành động để lọc (Admin only)",
)
def get_audit_actions(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **UC45 - Get Distinct Audit Actions (Admin only)**:
    Lấy danh sách các loại hành động duy nhất có trong nhật ký để hiển thị dropdown bộ lọc.
    """
    return audit_service.get_distinct_actions(db)
