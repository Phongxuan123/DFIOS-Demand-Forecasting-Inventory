from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel, Field, field_validator

UserRole = Literal["Admin", "Warehouse Manager", "Viewer"]

class UserResponse(BaseModel):
    id: str
    email: str
    role: str
    display_name: Optional[str] = None
    is_active: bool = True
    is_verified: bool = False
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class UserCreateRequest(BaseModel):
    email: str = Field(..., description="Email người dùng")
    password: Optional[str] = Field(None, min_length=6, max_length=72, description="Mật khẩu (6 đến 72 ký tự, tối đa 72 bytes, để trống để gửi link kích hoạt)")
    role: UserRole = Field(..., description="Vai trò: Admin | Warehouse Manager | Viewer")
    display_name: Optional[str] = Field(None, description="Tên hiển thị")

    @field_validator("password")
    @classmethod
    def check_password_bytes(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v.encode("utf-8")) > 72:
            raise ValueError("Mật khẩu không được vượt quá 72 bytes (giới hạn bảo mật của thuật toán bcrypt).")
        return v


class UserUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None

class UserStatusUpdateRequest(BaseModel):
    is_active: bool = Field(..., description="Trạng thái kích hoạt (True) hoặc vô hiệu hóa (False)")
