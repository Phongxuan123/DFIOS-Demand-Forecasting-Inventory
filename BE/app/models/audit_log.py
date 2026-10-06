from datetime import datetime, timezone
import uuid
from sqlalchemy import Column, String, DateTime, Text
from app.models.base import Base


class AuditLog(Base):
    """
    Model ghi nhận nhật ký hoạt động hệ thống và bảo mật (UC45).
    """
    __tablename__ = "audit_logs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    actor_email = Column(String, nullable=True, index=True)
    action = Column(String, nullable=False, index=True)
    ip_address = Column(String, nullable=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
