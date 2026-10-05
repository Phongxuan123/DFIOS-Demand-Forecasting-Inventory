from fastapi import HTTPException, status
from sqlalchemy.orm import Session

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
from app.repositories.user_repository import user_repository
from app.core.security import (
    verify_password,
    get_password_hash,
    create_access_token,
    create_password_reset_token,
    verify_password_reset_token,
)

class AuthService:
    def login(self, db: Session, login_data: LoginRequest) -> LoginResponse:
        """
        UC01: Xác thực tài khoản người dùng và cấp token JWT
        """
        user = user_repository.get_by_email(db, login_data.email)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Email hoặc mật khẩu không chính xác",
            )
        
        # Kiểm tra tài khoản có bị vô hiệu hóa không
        if not getattr(user, "is_active", True):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Tài khoản của bạn đã bị vô hiệu hóa. Vui lòng liên hệ quản trị viên.",
            )
        
        if not verify_password(login_data.password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Email hoặc mật khẩu không chính xác",
            )
        
        access_token = create_access_token(
            data={"sub": user.email, "role": user.role, "user_id": user.id}
        )
        
        return LoginResponse(
            access_token=access_token,
            token_type="bearer",
            user=UserResponse.model_validate(user),
        )

    def logout(self, user: User) -> MessageResponse:
        """
        UC02: Kết thúc phiên làm việc
        """
        return MessageResponse(
            message=f"Người dùng {user.email} đã đăng xuất thành công.",
        )

    def request_password_reset(self, db: Session, request: ForgotPasswordRequest) -> MessageResponse:
        """
        UC03: Yêu cầu đặt lại mật khẩu qua email
        """
        user = user_repository.get_by_email(db, request.email)
        if not user:
            # Vì lý do bảo mật, không báo lộ việc email có tồn tại hay không
            return MessageResponse(
                message="Nếu email này tồn tại trong hệ thống, hướng dẫn đặt lại mật khẩu đã được gửi đi.",
            )
        
        reset_token = create_password_reset_token(user.email, expires_minutes=15)
        
        return MessageResponse(
            message="Yêu cầu đặt lại mật khẩu đã được chấp thuận. Vui lòng dùng token để tạo mật khẩu mới trong vòng 15 phút.",
            detail=reset_token
        )

    def reset_password(self, db: Session, request: ResetPasswordRequest) -> MessageResponse:
        """
        UC03: Xác nhận token và tạo mật khẩu mới
        """
        email = verify_password_reset_token(request.token)
        if not email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Mã token đặt lại mật khẩu không hợp lệ hoặc đã hết hạn (chỉ có hiệu lực trong 15 phút).",
            )
        
        user = user_repository.get_by_email(db, email)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Người dùng không tồn tại.",
            )
        
        new_hash = get_password_hash(request.new_password)
        user_repository.update_password(db, user, new_hash)
        
        return MessageResponse(
            message="Đặt lại mật khẩu thành công! Bạn có thể đăng nhập bằng mật khẩu mới.",
        )

    def change_password(self, db: Session, user: User, request: ChangePasswordRequest) -> MessageResponse:
        """
        UC04: Người dùng tự đổi mật khẩu khi đã đăng nhập
        """
        if not verify_password(request.old_password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Mật khẩu hiện tại không chính xác.",
            )
        
        if request.old_password == request.new_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Mật khẩu mới không được trùng với mật khẩu cũ.",
            )
        
        new_hash = get_password_hash(request.new_password)
        user_repository.update_password(db, user, new_hash)
        
        return MessageResponse(
            message="Đổi mật khẩu thành công!",
        )

    def update_profile(self, db: Session, user: User, request: UpdateProfileRequest) -> UserResponse:
        """
        UC05: Cập nhật thông tin cá nhân (display_name, email)
        """
        if request.email and request.email != user.email:
            existing = user_repository.get_by_email(db, request.email)
            if existing and existing.id != user.id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Email '{request.email}' đã được sử dụng bởi tài khoản khác.",
                )
            user.email = request.email
        
        if request.display_name is not None:
            user.display_name = request.display_name
        
        updated_user = user_repository.update(db, user)
        return UserResponse.model_validate(updated_user)

auth_service = AuthService()
