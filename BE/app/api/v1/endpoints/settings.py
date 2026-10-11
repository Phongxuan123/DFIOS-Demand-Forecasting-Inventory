from typing import Optional
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user, require_admin
from app.models.user import User
from app.schemas.system_setting import (
    SettingItem,
    SettingsListResponse,
    SettingUpdateRequest,
)
from app.services.system_setting_service import system_setting_service

router = APIRouter()


def get_client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


@router.get("", response_model=SettingsListResponse, summary="UC44 - Lấy toàn bộ cấu hình hệ thống")
def get_all_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    **UC44 - Configure General System Settings**:
    Lấy danh sách và từ điển các tham số vận hành chung của hệ thống (múi giờ, tiền tệ, ngưỡng cảnh báo, khoảng dự báo).
    *Quyền truy cập: Mọi người dùng đã đăng nhập (Viewer, Warehouse Manager, Admin).*
    """
    return system_setting_service.get_all_settings(db)


@router.get("/{key}", response_model=SettingItem, summary="UC44 - Lấy chi tiết một tham số cấu hình")
def get_setting(
    key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    **UC44 - Configure General System Settings**:
    Lấy chi tiết một tham số cấu hình hệ thống theo `key`.
    *Quyền truy cập: Mọi người dùng đã đăng nhập.*
    """
    return system_setting_service.get_setting(db, key=key)


@router.put("/{key}", response_model=SettingItem, summary="UC44 - Cập nhật tham số cấu hình hệ thống (Admin only)")
def update_setting(
    key: str,
    req_body: SettingUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **UC44 - Configure General System Settings**:
    Cập nhật giá trị của một tham số hệ thống. Tự động ghi nhật ký kiểm toán (Audit Log) giá trị cũ -> giá trị mới.
    *Quyền truy cập: Chỉ Admin.*
    """
    ip = get_client_ip(request)
    return system_setting_service.update_setting(
        db,
        key=key,
        request=req_body,
        admin_email=admin.email,
        ip_address=ip,
    )
