from typing import Optional
from pydantic import BaseModel, Field
from app.schemas.user import UserResponse

class LoginRequest(BaseModel):
    email: str = Field(..., description="Email đăng nhập")
    password: str = Field(..., description="Mật khẩu")

class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

class ChangePasswordRequest(BaseModel):
    old_password: str = Field(..., description="Mật khẩu hiện tại")
    new_password: str = Field(..., min_length=6, description="Mật khẩu mới (tối thiểu 6 ký tự)")

class ForgotPasswordRequest(BaseModel):
    email: str = Field(..., description="Email tài khoản cần đặt lại mật khẩu")

class ResetPasswordRequest(BaseModel):
    token: str = Field(..., description="Mã token đặt lại mật khẩu")
    new_password: str = Field(..., min_length=6, description="Mật khẩu mới (tối thiểu 6 ký tự)")

class UpdateProfileRequest(BaseModel):
    display_name: Optional[str] = Field(None, description="Tên hiển thị mới")
    email: Optional[str] = Field(None, description="Email liên hệ mới")

class MessageResponse(BaseModel):
    message: str
    detail: Optional[str] = None
