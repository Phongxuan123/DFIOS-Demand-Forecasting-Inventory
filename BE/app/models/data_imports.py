from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, DateTime, JSON
from app.models.base import Base

class DataImport(Base):
    __tablename__ = "data_imports"

    id = Column(String(100), primary_key=True)
    file_name = Column(String(255), nullable=False)
    file_type = Column(String(50), nullable=False)
    row_count = Column(Integer, default=0)
    status = Column(String(50), default="COMPLETED")
    uploaded_by = Column(String(100), default="system")
    summary = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

