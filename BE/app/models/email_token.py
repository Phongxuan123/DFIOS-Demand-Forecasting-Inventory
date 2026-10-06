from datetime import datetime, timezone
import uuid
from sqlalchemy import Column, String, DateTime, ForeignKey, Index
from app.models.base import Base


class EmailToken(Base):
    """
    Model lưu trữ token xác thực qua email cho 3 luồng:
    1. activate: Kích hoạt tài khoản và đặt mật khẩu lần đầu
    2. reset_password: Đặt lại mật khẩu khi quên
    3. change_email: Xác thực đổi địa chỉ email mới
    """
    __tablename__ = "email_tokens"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    purpose = Column(String, nullable=False)  # "activate" | "reset_password" | "change_email"
    token_hash = Column(String, nullable=False, index=True)
    new_email = Column(String, nullable=True)  # Chỉ dùng cho mục đích change_email
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        Index("ix_email_tokens_user_purpose", "user_id", "purpose"),
    )
