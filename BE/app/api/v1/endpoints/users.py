from typing import List
from fastapi import APIRouter, Depends, Query, Request, BackgroundTasks
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin
from app.models.user import User
from app.schemas.user import (
    UserResponse,
    UserCreateRequest,
    UserUpdateRequest,
    UserStatusUpdateRequest,
)
from app.schemas.auth import MessageResponse
from app.services.user_service import user_service

router = APIRouter()


def get_client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


@router.get("", response_model=List[UserResponse], summary="UC06 - Danh sách tài khoản người dùng")
def list_users(
    skip: int = Query(0, ge=0, description="Số lượng bản ghi bỏ qua"),
    limit: int = Query(100, ge=1, le=500, description="Số lượng bản ghi tối đa lấy về"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **UC06 - List Users (Admin only)**:
    Lấy danh sách tất cả các tài khoản người dùng trong hệ thống.
    """
    return user_service.list_users(db, skip=skip, limit=limit)


@router.post("", response_model=UserResponse, summary="UC06 - Tạo tài khoản mới & gán vai trò")
def create_user(
    req_body: UserCreateRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **UC06 - Create User (Admin only)**:
    Admin tạo tài khoản người dùng mới và phân quyền (Admin / Warehouse Manager / Viewer).
    Nếu không truyền mật khẩu, tài khoản ở trạng thái chưa kích hoạt và tự động gửi email kích hoạt.
    """
    ip = get_client_ip(request)
    return user_service.create_user(
        db,
        request=req_body,
        background_tasks=background_tasks,
        admin_email=admin.email,
        ip_address=ip,
    )


@router.post("/{user_id}/resend-activation", response_model=MessageResponse, summary="UC06 - Gửi lại email kích hoạt tài khoản")
def resend_activation_email(
    user_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **UC06 - Resend Activation (Admin only)**:
    Gửi lại liên kết kích hoạt tài khoản qua email cho người dùng chưa kích hoạt.
    """
    ip = get_client_ip(request)
    return user_service.resend_activation_email(
        db,
        user_id=user_id,
        background_tasks=background_tasks,
        admin_email=admin.email,
        ip_address=ip,
    )


@router.get("/{user_id}", response_model=UserResponse, summary="UC06 - Xem chi tiết tài khoản")
def get_user(
    user_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **UC06 - Get User Detail (Admin only)**:
    Lấy thông tin chi tiết một tài khoản theo User ID.
    """
    return user_service.get_user_by_id(db, user_id)


@router.put("/{user_id}", response_model=UserResponse, summary="UC06 - Cập nhật thông tin & gán lại vai trò")
def update_user(
    user_id: str,
    req_body: UserUpdateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **UC06 - Update User & Role Assignment (Admin only)**:
    Admin chỉnh sửa thông tin tài khoản và thay đổi vai trò (role) của người dùng.
    """
    return user_service.update_user(db, user_id, req_body)


@router.patch("/{user_id}/status", response_model=UserResponse, summary="UC06 - Kích hoạt / Vô hiệu hóa tài khoản")
def toggle_status(
    user_id: str,
    req_body: UserStatusUpdateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **UC06 - Toggle User Active Status (Admin only)**:
    Admin kích hoạt (True) hoặc vô hiệu hóa (False) tài khoản người dùng.
    """
    return user_service.toggle_user_status(db, user_id=user_id, request=req_body, current_admin=admin)


@router.delete("/{user_id}", response_model=MessageResponse, summary="UC06 - Xóa tài khoản")
def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **UC06 - Delete User (Admin only)**:
    Admin xóa vĩnh viễn một tài khoản khỏi hệ thống.
    """
    return user_service.delete_user(db, current_admin=admin, user_id=user_id)
