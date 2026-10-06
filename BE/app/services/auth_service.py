from typing import Optional
from fastapi import HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session

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
from app.repositories.user_repository import user_repository
from app.core.security import (
    verify_password,
    get_password_hash,
    create_access_token,
)
from app.services import email_service
from app.services.email_service import (
    render_password_reset_email,
    render_confirm_change_email,
    render_notify_old_email_changed,
)
from app.services.email_token_service import email_token_service, rate_limiter
from app.services.audit_service import audit_service
from app.core.config import settings


class AuthService:
    def login(self, db: Session, login_data: LoginRequest) -> LoginResponse:
        """
        UC01: Xác thực tài khoản người dùng và cấp token JWT
        """
        user = user_repository.get_by_email(db, login_data.email.strip().lower())
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Email hoặc mật khẩu không chính xác",
            )
        
        # Kiểm tra tài khoản có bị vô hiệu hóa không
        if not getattr(user, "is_active", True):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Tài khoản của bạn đã bị vô hiệu hóa hoặc chưa kích hoạt. Vui lòng liên hệ quản trị viên.",
            )
        
        if not verify_password(login_data.password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Email hoặc mật khẩu không chính xác",
            )
        
        access_token = create_access_token(
            data={
                "sub": user.email,
                "role": user.role,
                "user_id": user.id,
                "token_version": getattr(user, "token_version", 1),
            }
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

    def activate_account(
        self,
        db: Session,
        request: ActivateAccountRequest,
        ip_address: Optional[str] = None,
    ) -> MessageResponse:
        """
        Kích hoạt tài khoản và đặt mật khẩu lần đầu qua email token (UC06).
        """
        token_record = email_token_service.consume_token(
            db, raw_token=request.token, expected_purpose="activate"
        )

        user = user_repository.get_by_id(db, token_record.user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Link không hợp lệ hoặc đã hết hạn",
            )

        user.password_hash = get_password_hash(request.password)
        user.is_active = True
        user.is_verified = True
        user.token_version = getattr(user, "token_version", 1) + 1

        db.commit()
        db.refresh(user)

        audit_service.log(
            db,
            action="auth.activate",
            actor_email=user.email,
            ip_address=ip_address,
            details="Kích hoạt tài khoản và thiết lập mật khẩu lần đầu thành công",
        )
        db.commit()

        return MessageResponse(
            message="Kích hoạt tài khoản thành công! Bạn có thể đăng nhập ngay bây giờ.",
        )

    def request_password_reset(
        self,
        db: Session,
        request: ForgotPasswordRequest,
        background_tasks: BackgroundTasks,
        ip_address: Optional[str] = None,
    ) -> MessageResponse:
        """
        UC03: Yêu cầu đặt lại mật khẩu qua email.
        LUÔN trả về HTTP 200 với thông điệp thống nhất (chống rò rỉ danh sách tài khoản).
        """
        email_clean = request.email.strip().lower()

        # Kiểm tra rate limit (tối đa 5 lần / giờ / email)
        if rate_limiter.is_rate_limited(
            key=f"reset:{email_clean}",
            max_requests=settings.EMAIL_RATE_LIMIT_PER_HOUR,
        ):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Bạn đã yêu cầu đặt lại mật khẩu quá nhiều lần. Vui lòng thử lại sau 1 giờ.",
            )

        generic_response = MessageResponse(
            message="Nếu email này tồn tại trong hệ thống và đang hoạt động, hướng dẫn đặt lại mật khẩu đã được gửi đến hộp thư của bạn.",
        )

        user = user_repository.get_by_email(db, email_clean)
        if not user or not getattr(user, "is_active", True):
            # Không gửi email, trả thông điệp thống nhất
            return generic_response

        # Tạo token đặt lại mật khẩu (30 phút)
        token_record, raw_token = email_token_service.create_token(
            db, user_id=user.id, purpose="reset_password"
        )
        db.commit()

        # Gửi email chạy nền (non-blocking)
        subject, html_body, text_body = render_password_reset_email(user.email, raw_token)
        background_tasks.add_task(
            email_service.email_sender.send_email,
            to_email=user.email,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
        )

        audit_service.log(
            db,
            action="auth.request_reset_password",
            actor_email=user.email,
            ip_address=ip_address,
            details="Gửi yêu cầu đặt lại mật khẩu",
        )
        db.commit()

        return generic_response

    def reset_password(
        self,
        db: Session,
        request: ResetPasswordRequest,
        ip_address: Optional[str] = None,
    ) -> MessageResponse:
        """
        UC03: Xác nhận token và tạo mật khẩu mới.
        Thu hồi toàn bộ phiên JWT cũ của người dùng bằng cách tăng token_version.
        """
        token_record = email_token_service.consume_token(
            db, raw_token=request.token, expected_purpose="reset_password"
        )

        user = user_repository.get_by_id(db, token_record.user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Link không hợp lệ hoặc đã hết hạn",
            )

        new_hash = get_password_hash(request.new_password)
        user.password_hash = new_hash
        # Thu hồi toàn bộ token JWT cũ
        user.token_version = getattr(user, "token_version", 1) + 1

        db.commit()
        db.refresh(user)

        audit_service.log(
            db,
            action="auth.reset_password",
            actor_email=user.email,
            ip_address=ip_address,
            details="Đặt lại mật khẩu thành công qua email token. Đã thu hồi toàn bộ phiên đăng nhập cũ.",
        )
        db.commit()

        return MessageResponse(
            message="Đặt lại mật khẩu thành công! Tất cả các phiên đăng nhập cũ đã được thu hồi. Bạn có thể đăng nhập bằng mật khẩu mới.",
        )

    def change_password(
        self,
        db: Session,
        user: User,
        request: ChangePasswordRequest,
        ip_address: Optional[str] = None,
    ) -> MessageResponse:
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
        user.password_hash = new_hash
        user.token_version = getattr(user, "token_version", 1) + 1
        db.commit()
        db.refresh(user)

        audit_service.log(
            db,
            action="auth.change_password",
            actor_email=user.email,
            ip_address=ip_address,
            details="Người dùng tự đổi mật khẩu khi đang đăng nhập",
        )
        db.commit()
        
        return MessageResponse(
            message="Đổi mật khẩu thành công!",
        )

    def request_change_email(
        self,
        db: Session,
        user: User,
        request: ChangeEmailRequest,
        background_tasks: BackgroundTasks,
        ip_address: Optional[str] = None,
    ) -> MessageResponse:
        """
        UC05: Yêu cầu đổi email liên hệ.
        Gửi link xác nhận đến địa chỉ email MỚI.
        """
        # Kiểm tra rate limit
        if rate_limiter.is_rate_limited(
            key=f"change_email:{user.id}",
            max_requests=settings.EMAIL_RATE_LIMIT_PER_HOUR,
        ):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Bạn đã gửi yêu cầu đổi email quá nhiều lần. Vui lòng thử lại sau 1 giờ.",
            )

        # Bắt buộc nhập đúng mật khẩu hiện tại
        if not verify_password(request.current_password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Mật khẩu hiện tại không chính xác.",
            )

        new_email = request.new_email.strip().lower()
        if new_email == user.email.lower():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email mới không được trùng với email hiện tại của tài khoản.",
            )

        # Kiểm tra email mới đã có người dùng nào khác sử dụng chưa
        existing = user_repository.get_by_email(db, new_email)
        if existing and existing.id != user.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Địa chỉ email '{new_email}' đã được sử dụng bởi một tài khoản khác.",
            )

        # Sinh token mục đích change_email lưu kèm new_email
        token_record, raw_token = email_token_service.create_token(
            db, user_id=user.id, purpose="change_email", new_email=new_email
        )
        db.commit()

        # Gửi link xác nhận tới địa chỉ email MỚI
        subject, html_body, text_body = render_confirm_change_email(new_email, raw_token)
        background_tasks.add_task(
            email_service.email_sender.send_email,
            to_email=new_email,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
        )

        audit_service.log(
            db,
            action="auth.request_change_email",
            actor_email=user.email,
            ip_address=ip_address,
            details=f"Yêu cầu đổi email sang {new_email}",
        )
        db.commit()

        return MessageResponse(
            message=f"Liên kết xác nhận đã được gửi đến địa chỉ email mới ({new_email}). Vui lòng kiểm tra hộp thư để xác nhận thay đổi.",
        )

    def confirm_change_email(
        self,
        db: Session,
        request: ConfirmChangeEmailRequest,
        background_tasks: BackgroundTasks,
        ip_address: Optional[str] = None,
    ) -> MessageResponse:
        """
        UC05: Xác nhận đổi email từ liên kết gửi trong mail mới.
        Sau khi đổi, gửi thông báo cảnh báo tới email CŨ.
        """
        token_record = email_token_service.consume_token(
            db, raw_token=request.token, expected_purpose="change_email"
        )

        user = user_repository.get_by_id(db, token_record.user_id)
        if not user or not token_record.new_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Link không hợp lệ hoặc đã hết hạn",
            )

        # Kiểm tra lại một lần nữa để tránh email mới bị người khác đăng ký trong thời gian chờ
        existing = user_repository.get_by_email(db, token_record.new_email)
        if existing and existing.id != user.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Địa chỉ email '{token_record.new_email}' đã bị sử dụng bởi tài khoản khác trong thời gian chờ xác nhận.",
            )

        old_email = user.email
        new_email = token_record.new_email

        user.email = new_email
        user.is_verified = True
        db.commit()
        db.refresh(user)

        # Gửi thông báo tới email CŨ
        subject, html_body, text_body = render_notify_old_email_changed(old_email, new_email)
        background_tasks.add_task(
            email_service.email_sender.send_email,
            to_email=old_email,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
        )

        audit_service.log(
            db,
            action="auth.confirm_change_email",
            actor_email=user.email,
            ip_address=ip_address,
            details=f"Đổi email thành công từ {old_email} sang {new_email}",
        )
        db.commit()

        return MessageResponse(
            message=f"Đổi email thành công! Email đăng nhập mới của bạn là {new_email}.",
        )

    def update_profile(self, db: Session, user: User, request: UpdateProfileRequest) -> UserResponse:
        """
        UC05: Cập nhật thông tin cá nhân (chỉ đổi display_name, việc đổi email bắt buộc qua luồng xác minh /me/email)
        """
        if request.display_name is not None:
            user.display_name = request.display_name
        
        updated_user = user_repository.update(db, user)
        return UserResponse.model_validate(updated_user)


auth_service = AuthService()
