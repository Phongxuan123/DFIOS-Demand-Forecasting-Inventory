from datetime import datetime, timezone
import uuid
from sqlalchemy import Column, String, DateTime, Boolean, JSON
from app.models.base import Base


class DataQualityRun(Base):
    """
    Model lưu trữ kết quả kiểm tra chất lượng dữ liệu & chống rò rỉ (UC46).
    """
    __tablename__ = "data_quality_runs"

    id = Column(String(50), primary_key=True, default=lambda: str(uuid.uuid4()))
    triggered_by = Column(String(100), nullable=True)
    status = Column(String(20), nullable=False)  # PASSED, FAILED, WARNING
    passed = Column(Boolean, nullable=False, default=False)
    summary = Column(JSON, nullable=False)
    issues = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
