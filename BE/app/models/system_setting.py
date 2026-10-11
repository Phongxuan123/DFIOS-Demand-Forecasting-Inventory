from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, JSON
from app.models.base import Base


class SystemSetting(Base):
    """
    Bảng cấu hình hệ thống chung (UC44 - System Administration).
    Lưu trữ các tham số vận hành chung dưới dạng key-value JSON có kiểm tra kiểu.
    """
    __tablename__ = "system_settings"

    key = Column(String(100), primary_key=True, index=True)
    value = Column(JSON, nullable=False)
    description = Column(String(255), nullable=True)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
