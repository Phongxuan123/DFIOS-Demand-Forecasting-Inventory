from datetime import datetime, timezone
import uuid
from sqlalchemy import Column, String, DateTime, Text
from app.models.base import Base

# Values of ``AuditLog.result`` (written by AuditService.log). ``unknown`` = legacy row written before the column
# existed (backfilled by app/core/schema_upgrades.py; its outcome was never recorded and is not guessed).
AUDIT_RESULT_SUCCESS = "SUCCESS"
AUDIT_RESULT_FAILURE = "FAILURE"
AUDIT_RESULT_UNKNOWN = "unknown"


class AuditLog(Base):
    """
    Model ghi nhận nhật ký hoạt động hệ thống và bảo mật (UC45).
    ``result``: outcome RECORDED by the service that wrote the row (SUCCESS | FAILURE), ``unknown`` for legacy rows.
    """
    __tablename__ = "audit_logs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    actor_email = Column(String, nullable=True, index=True)
    action = Column(String, nullable=False, index=True)
    ip_address = Column(String, nullable=True)
    details = Column(Text, nullable=True)
    result = Column(String(20), nullable=True, default=AUDIT_RESULT_SUCCESS)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)


class LoginFailure(Base):
    """
    Q-17: failed logins shared by every API process (the in-memory limiter is per process). The per-email login
    budget (10 failures / 5 min) is counted from this table, so several uvicorn workers cannot multiply it.
    Rows older than the window are pruned on write.
    """
    __tablename__ = "login_failures"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    key = Column(String(320), nullable=False, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
