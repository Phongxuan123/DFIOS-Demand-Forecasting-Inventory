from typing import Optional
from pydantic import BaseModel, Field, field_validator
from app.schemas.user import UserResponse

def _validate_max_bytes(v: Optional[str]) -> Optional[str]:
    if v is not None and len(v.encode("utf-8")) > 72:
        raise ValueError("Mật khẩu không được vượt quá 72 bytes (giới hạn bảo mật của thuật toán bcrypt).")
    return v

class LoginRequest(BaseModel):
    email: str = Field(..., description="Email đăng nhập")
    password: str = Field(..., max_length=72, description="Mật khẩu (tối đa 72 ký tự và tối đa 72 bytes)")

    @field_validator("password")
    @classmethod
    def check_password_bytes(cls, v: str) -> str:
        return _validate_max_bytes(v)

class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

class ChangePasswordRequest(BaseModel):
    old_password: str = Field(..., max_length=72, description="Mật khẩu hiện tại")
    new_password: str = Field(..., min_length=6, max_length=72, description="Mật khẩu mới (6 đến 72 ký tự, tối đa 72 bytes)")

    @field_validator("old_password", "new_password")
    @classmethod
    def check_password_bytes(cls, v: str) -> str:
        return _validate_max_bytes(v)

class ForgotPasswordRequest(BaseModel):
    email: str = Field(..., description="Email tài khoản cần đặt lại mật khẩu")

class ResetPasswordRequest(BaseModel):
    token: str = Field(..., description="Mã token đặt lại mật khẩu")
    new_password: str = Field(..., min_length=6, max_length=72, description="Mật khẩu mới (6 đến 72 ký tự, tối đa 72 bytes)")

    @field_validator("new_password")
    @classmethod
    def check_password_bytes(cls, v: str) -> str:
        return _validate_max_bytes(v)

class UpdateProfileRequest(BaseModel):
    display_name: Optional[str] = Field(None, description="Tên hiển thị mới")
    email: Optional[str] = Field(None, description="Email liên hệ mới")

class ActivateAccountRequest(BaseModel):
    token: str = Field(..., description="Token kích hoạt tài khoản")
    password: str = Field(..., min_length=6, max_length=72, description="Mật khẩu thiết lập lần đầu (6 đến 72 ký tự, tối đa 72 bytes)")

    @field_validator("password")
    @classmethod
    def check_password_bytes(cls, v: str) -> str:
        return _validate_max_bytes(v)

class ChangeEmailRequest(BaseModel):
    new_email: str = Field(..., description="Địa chỉ email mới muốn thay đổi")
    current_password: str = Field(..., max_length=72, description="Mật khẩu hiện tại để xác thực")

    @field_validator("current_password")
    @classmethod
    def check_password_bytes(cls, v: str) -> str:
        return _validate_max_bytes(v)

class ConfirmChangeEmailRequest(BaseModel):
    token: str = Field(..., description="Token xác nhận đổi email gửi trong hòm thư mới")

class MessageResponse(BaseModel):
    message: str
    detail: Optional[str] = None

