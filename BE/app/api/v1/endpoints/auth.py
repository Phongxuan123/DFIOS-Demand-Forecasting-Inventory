from fastapi import APIRouter, Depends, Request, BackgroundTasks
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
    ActivateAccountRequest,
    ChangeEmailRequest,
    ConfirmChangeEmailRequest,
    MessageResponse,
)
from app.schemas.user import UserResponse
from app.services.auth_service import auth_service

router = APIRouter()


def get_client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


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


@router.post("/activate", response_model=MessageResponse, summary="Kích hoạt tài khoản và đặt mật khẩu lần đầu (UC06)")
def activate_account(
    req_body: ActivateAccountRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    **Kích hoạt tài khoản (UC06)**:
    Người dùng mở liên kết kích hoạt từ email, nhập mật khẩu lần đầu.
    Hệ thống kích hoạt tài khoản, đánh dấu email đã xác thực và lưu mật khẩu mới.
    """
    ip = get_client_ip(request)
    return auth_service.activate_account(db, req_body, ip_address=ip)


@router.post("/forgot-password", response_model=MessageResponse, summary="UC03 - Yêu cầu đặt lại mật khẩu")
def forgot_password(
    req_body: ForgotPasswordRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    **UC03 - Forgot Password**:
    Gửi liên kết đặt lại mật khẩu qua email.
    LUÔN trả về HTTP 200 thống nhất để ngăn chặn dò quét tài khoản.
    """
    ip = get_client_ip(request)
    return auth_service.request_password_reset(db, req_body, background_tasks=background_tasks, ip_address=ip)


@router.post("/reset-password", response_model=MessageResponse, summary="UC03 - Đặt mật khẩu mới qua token")
def reset_password(
    req_body: ResetPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    **UC03 - Reset Password**:
    Xác nhận token hợp lệ một lần duy nhất, đặt mật khẩu mới và thu hồi toàn bộ phiên JWT cũ.
    """
    ip = get_client_ip(request)
    return auth_service.reset_password(db, req_body, ip_address=ip)


@router.post("/change-password", response_model=MessageResponse, summary="UC04 - Tự đổi mật khẩu")
def change_password(
    req_body: ChangePasswordRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    **UC04 - Change Password**:
    Người dùng đã đăng nhập tự đổi mật khẩu bằng cách xác nhận mật khẩu cũ và nhập mật khẩu mới.
    """
    ip = get_client_ip(request)
    return auth_service.change_password(db, current_user, req_body, ip_address=ip)


@router.get("/me", response_model=UserResponse, summary="UC05 - Xem thông tin cá nhân")
def get_me(current_user: User = Depends(get_current_user)):
    """
    **UC05 - View Personal Profile**:
    Người dùng xem thông tin cá nhân của tài khoản đang đăng nhập.
    """
    return UserResponse.model_validate(current_user)


@router.put("/profile", response_model=UserResponse, summary="UC05 - Cập nhật thông tin cá nhân")
def update_profile(
    req_body: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    **UC05 - Update Personal Profile**:
    Người dùng chỉnh sửa thông tin cá nhân (tên hiển thị).
    """
    return auth_service.update_profile(db, current_user, req_body)


@router.post("/me/email", response_model=MessageResponse, summary="UC05 - Yêu cầu đổi địa chỉ email")
def request_change_email(
    req_body: ChangeEmailRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    **UC05 - Request Change Email**:
    Yêu cầu đổi email liên hệ (yêu cầu mật khẩu hiện tại).
    Gửi liên kết xác nhận đến địa chỉ email MỚI.
    """
    ip = get_client_ip(request)
    return auth_service.request_change_email(
        db, current_user, req_body, background_tasks=background_tasks, ip_address=ip
    )


@router.post("/me/email/confirm", response_model=MessageResponse, summary="UC05 - Xác nhận đổi email qua token")
def confirm_change_email(
    req_body: ConfirmChangeEmailRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    **UC05 - Confirm Change Email**:
    Xác nhận token đổi email. Cập nhật email tài khoản và gửi cảnh báo đến email CŨ.
    """
    ip = get_client_ip(request)
    return auth_service.confirm_change_email(
        db, req_body, background_tasks=background_tasks, ip_address=ip
    )
