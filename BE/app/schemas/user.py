from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel, Field

UserRole = Literal["Admin", "Warehouse Manager", "Viewer"]

class UserResponse(BaseModel):
    id: str
    email: str
    role: str
    display_name: Optional[str] = None
    is_active: bool = True
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class UserCreateRequest(BaseModel):
    email: str = Field(..., description="Email người dùng")
    password: str = Field(..., min_length=6, description="Mật khẩu tối thiểu 6 ký tự")
    role: UserRole = Field(..., description="Vai trò: Admin | Warehouse Manager | Viewer")
    display_name: Optional[str] = Field(None, description="Tên hiển thị")

class UserUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None

class UserStatusUpdateRequest(BaseModel):
    is_active: bool = Field(..., description="Trạng thái kích hoạt (True) hoặc vô hiệu hóa (False)")
