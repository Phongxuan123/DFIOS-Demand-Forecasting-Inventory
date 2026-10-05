import uuid
from typing import List
from fastapi import HTTPException, status
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

    def create_user(self, db: Session, request: UserCreateRequest) -> UserResponse:
        """
        UC06: Admin tạo tài khoản người dùng mới và phân vai trò (Role)
        """
        existing = user_repository.get_by_email(db, request.email)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Email '{request.email}' đã tồn tại trong hệ thống.",
            )
        
        new_user = User(
            id=str(uuid.uuid4()),
            email=request.email,
            password_hash=get_password_hash(request.password),
            role=request.role,
            display_name=request.display_name or request.email.split("@")[0],
            is_active=True,
        )
        saved_user = user_repository.create(db, new_user)
        return UserResponse.model_validate(saved_user)

    def update_user(self, db: Session, user_id: str, request: UserUpdateRequest) -> UserResponse:
        """
        UC06: Admin chỉnh sửa thông tin tài khoản và gán lại vai trò
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
        self, db: Session, current_admin: User, user_id: str, request: UserStatusUpdateRequest
    ) -> UserResponse:
        """
        UC06: Admin kích hoạt hoặc vô hiệu hóa tài khoản
        """
        if current_admin.id == user_id and not request.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Bạn không thể tự vô hiệu hóa tài khoản quản trị viên của chính mình.",
            )
        
        user = user_repository.get_by_id(db, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy người dùng có ID '{user_id}'",
            )
        
        updated_user = user_repository.update_status(db, user, request.is_active)
        return UserResponse.model_validate(updated_user)

    def delete_user(self, db: Session, current_admin: User, user_id: str) -> MessageResponse:
        """
        UC06: Admin xóa vĩnh viễn tài khoản người dùng
        """
        if current_admin.id == user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Bạn không thể tự xóa tài khoản của chính mình.",
            )
        
        user = user_repository.get_by_id(db, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy người dùng có ID '{user_id}'",
            )
        
        email = user.email
        user_repository.delete_user(db, user)
        return MessageResponse(message=f"Đã xóa tài khoản {email} thành công.")

user_service = UserService()
