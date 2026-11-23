from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user, require_admin, get_client_ip
from app.models.user import User
from app.schemas.system_setting import (
    SettingItem,
    SettingsListResponse,
    SettingUpdateRequest,
)
from app.services import simulation_parameters_service
from app.services.system_setting_service import system_setting_service

router = APIRouter()


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


class SimulationCostsUpdate(BaseModel):
    holding_rate: Optional[float] = Field(None, description="h: giữ kho / đơn vị / ngày, tỷ lệ của giá")
    stockout_penalty_rate: Optional[float] = Field(None, description="b: phạt / đơn vị mất bán, tỷ lệ của giá")
    order_cost: Optional[float] = Field(None, description="c: chi phí mỗi dòng đơn hàng")


@router.get("/simulation-parameters", summary="demo.md §1.3 - Tham số mô phỏng: L, R, h, b, c, mục tiêu, C³-OUT")
def get_simulation_parameters(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """L, R chỉ đọc (cửa sổ H = L + R của quantile đã lưu); h, b, c đổi được khi đồng hồ còn ở ngày đầu."""
    return simulation_parameters_service.get_parameters(db)


@router.put("/simulation-parameters", summary="demo.md §1.3 - Đổi chi phí h, b, c (Admin, khi đồng hồ ở ngày đầu)")
def update_simulation_costs(
    body: SimulationCostsUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """409 khi một đồng hồ đã tua khỏi ngày đầu: một lần replay giữ một bộ chi phí từ ngày đầu đến cuối."""
    return simulation_parameters_service.update_costs(
        db, body.holding_rate, body.stockout_penalty_rate, body.order_cost,
        actor_email=admin.email, ip_address=get_client_ip(request),
    )


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
