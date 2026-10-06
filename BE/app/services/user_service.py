import uuid
from typing import List, Optional
from fastapi import HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session

from app.models.user import User
from app.schemas.user import (
    UserResponse,
    UserCreateRequest,
    UserUpdateRequest,
    UserStatusUpdateRequest,
)
from app.schemas.auth import MessageResponse
from app.repositories.user_repository import user_repository
from app.core.security import get_password_hash
from app.services import email_service
from app.services.email_service import render_activation_email
from app.services.email_token_service import email_token_service
from app.services.audit_service import audit_service


class UserService:
    def list_users(self, db: Session, skip: int = 0, limit: int = 100) -> List[UserResponse]:
        """
        UC06: Lấy danh sách tài khoản người dùng
        """
        users = user_repository.get_all(db, skip=skip, limit=limit)
        return [UserResponse.model_validate(u) for u in users]

    def get_user_by_id(self, db: Session, user_id: str) -> UserResponse:
        """
        UC06: Lấy thông tin chi tiết một tài khoản
        """
        user = user_repository.get_by_id(db, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy người dùng có ID '{user_id}'",
            )
        return UserResponse.model_validate(user)

    def create_user(
        self,
        db: Session,
        request: UserCreateRequest,
        background_tasks: Optional[BackgroundTasks] = None,
        admin_email: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> UserResponse:
        """
        UC06: Admin tạo tài khoản người dùng mới và phân vai trò (Role).
        Nếu không truyền mật khẩu: Tài khoản ở trạng thái chưa kích hoạt (is_active=False, is_verified=False)
        và hệ thống tự động gửi email chứa link kích hoạt để người dùng tự đặt mật khẩu lần đầu.
        """
        clean_email = request.email.strip().lower()
        existing = user_repository.get_by_email(db, clean_email)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Email '{clean_email}' đã tồn tại trong hệ thống.",
            )

        # Nếu có mật khẩu truyền vào (manual/seed), đặt active luôn; ngược lại tạo user chưa kích hoạt
        has_password = bool(request.password and request.password.strip())
        is_active = has_password
        is_verified = has_password
        pwd_hash = (
            get_password_hash(request.password.strip())
            if has_password
            else get_password_hash(uuid.uuid4().hex)
        )

        new_user = User(
            id=str(uuid.uuid4()),
            email=clean_email,
            password_hash=pwd_hash,
            role=request.role,
            display_name=request.display_name or clean_email.split("@")[0],
            is_active=is_active,
            is_verified=is_verified,
            token_version=1,
        )
        saved_user = user_repository.create(db, new_user)

        # Nếu chưa có mật khẩu, gửi email kích hoạt tài khoản
        if not has_password:
            token_record, raw_token = email_token_service.create_token(
                db, user_id=saved_user.id, purpose="activate"
            )
            db.commit()

            subject, html_body, text_body = render_activation_email(saved_user.email, raw_token)
            if background_tasks:
                background_tasks.add_task(
                    email_service.email_sender.send_email,
                    to_email=saved_user.email,
                    subject=subject,
                    html_body=html_body,
                    text_body=text_body,
                )
            else:
                email_service.email_sender.send_email(
                    to_email=saved_user.email,
                    subject=subject,
                    html_body=html_body,
                    text_body=text_body,
                )

        audit_service.log(
            db,
            action="admin.create_user",
            actor_email=admin_email,
            ip_address=ip_address,
            details=f"Admin tạo tài khoản cho {saved_user.email} (Vai trò: {saved_user.role}, Kích hoạt: {saved_user.is_active})",
        )
        db.commit()

        return UserResponse.model_validate(saved_user)

    def resend_activation_email(
        self,
        db: Session,
        user_id: str,
        background_tasks: Optional[BackgroundTasks] = None,
        admin_email: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> MessageResponse:
        """
        UC06: Admin gửi lại liên kết kích hoạt tài khoản cho người dùng chưa kích hoạt.
        """
        user = user_repository.get_by_id(db, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy người dùng có ID '{user_id}'",
            )

        if user.is_active and user.is_verified:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tài khoản này đã được kích hoạt thành công từ trước.",
            )

        token_record, raw_token = email_token_service.create_token(
            db, user_id=user.id, purpose="activate"
        )
        db.commit()

        subject, html_body, text_body = render_activation_email(user.email, raw_token)
        if background_tasks:
            background_tasks.add_task(
                email_service.email_sender.send_email,
                to_email=user.email,
                subject=subject,
                html_body=html_body,
                text_body=text_body,
            )
        else:
            email_service.email_sender.send_email(
                to_email=user.email,
                subject=subject,
                html_body=html_body,
                text_body=text_body,
            )

        audit_service.log(
            db,
            action="admin.resend_activation",
            actor_email=admin_email,
            ip_address=ip_address,
            details=f"Admin gửi lại link kích hoạt tới {user.email}",
        )
        db.commit()

        return MessageResponse(
            message=f"Đã gửi lại email kích hoạt tài khoản tới {user.email}.",
        )

    def update_user(self, db: Session, user_id: str, request: UserUpdateRequest) -> UserResponse:
        """
        UC06: Chỉnh sửa thông tin tài khoản (display_name, role, is_active)
        """
        user = user_repository.get_by_id(db, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy người dùng có ID '{user_id}'",
            )
        
        if request.display_name is not None:
            user.display_name = request.display_name
        if request.role is not None:
            user.role = request.role
        if request.is_active is not None:
            user.is_active = request.is_active

        updated_user = user_repository.update(db, user)
        return UserResponse.model_validate(updated_user)

    def toggle_user_status(
        self, db: Session, user_id: str, request: UserStatusUpdateRequest, current_admin: User
    ) -> UserResponse:
        """
        UC06: Kích hoạt / Vô hiệu hóa tài khoản (Admin không được tự khóa chính mình)
        """
        if user_id == current_admin.id and not request.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Quản trị viên không thể tự vô hiệu hóa tài khoản của chính mình.",
            )

        user = user_repository.get_by_id(db, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy người dùng có ID '{user_id}'",
            )

        user.is_active = request.is_active
        updated_user = user_repository.update(db, user)
        return UserResponse.model_validate(updated_user)

    def delete_user(self, db: Session, current_admin: User, user_id: str) -> MessageResponse:
        """
        UC06: Xóa vĩnh viễn tài khoản
        """
        if user_id == current_admin.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Quản trị viên không thể tự xóa tài khoản của chính mình.",
            )
        user = user_repository.get_by_id(db, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy người dùng có ID '{user_id}'",
            )
        user_repository.delete(db, user)
        return MessageResponse(message=f"Đã xóa vĩnh viễn tài khoản {user.email}.")


user_service = UserService()

