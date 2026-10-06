from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    LoginResponse,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    UpdateProfileRequest,
    MessageResponse,
)
from app.schemas.user import UserResponse
from app.services.auth_service import auth_service

router = APIRouter()

@router.post("/login", response_model=LoginResponse, summary="UC01 - Đăng nhập tài khoản")
def login(request: LoginRequest, db: Session = Depends(get_db)):
    """
    **UC01 - Login**:
    Người dùng nhập email và mật khẩu; hệ thống xác thực và cấp phiên làm việc (JWT) tương ứng với role.
    """
    return auth_service.login(db, request)

@router.post("/logout", response_model=MessageResponse, summary="UC02 - Đăng xuất tài khoản")
def logout(current_user: User = Depends(get_current_user)):
    """
    **UC02 - Logout**:
    Người dùng kết thúc phiên làm việc hiện tại; hệ thống ghi nhận đăng xuất.
    """
    return auth_service.logout(current_user)

@router.post("/forgot-password", response_model=MessageResponse, summary="UC03 - Yêu cầu đặt lại mật khẩu")
def forgot_password(request: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """
    **UC03 - Forgot Password**:
    Người dùng gửi yêu cầu đặt lại mật khẩu qua email; hệ thống tạo token có thời hạn (15 phút).
    """
    return auth_service.request_password_reset(db, request)

@router.post("/reset-password", response_model=MessageResponse, summary="UC03 - Đặt mật khẩu mới qua token")
def reset_password(request: ResetPasswordRequest, db: Session = Depends(get_db)):
    """
    **UC03 - Reset Password**:
    Xác nhận token hợp lệ và tạo mật khẩu mới cho tài khoản.
    """
    return auth_service.reset_password(db, request)

@router.post("/change-password", response_model=MessageResponse, summary="UC04 - Tự đổi mật khẩu")
def change_password(
    request: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    **UC04 - Change Password**:
    Người dùng đã đăng nhập tự đổi mật khẩu bằng cách xác nhận mật khẩu cũ và nhập mật khẩu mới.
    """
    return auth_service.change_password(db, current_user, request)

@router.get("/me", response_model=UserResponse, summary="UC05 - Xem thông tin cá nhân")
def get_me(current_user: User = Depends(get_current_user)):
    """
    **UC05 - View Personal Profile**:
    Người dùng xem thông tin cá nhân của tài khoản đang đăng nhập.
    """
    return UserResponse.model_validate(current_user)

@router.put("/profile", response_model=UserResponse, summary="UC05 - Cập nhật thông tin cá nhân")
def update_profile(
    request: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    **UC05 - Update Personal Profile**:
    Người dùng chỉnh sửa thông tin cá nhân (tên hiển thị, email liên hệ).
    """
    return auth_service.update_profile(db, current_user, request)
