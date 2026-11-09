from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Date, Float, DateTime, Index
from app.models.base import Base

class ServiceOutcome(Base):
    __tablename__ = "service_outcomes"

    id = Column(String(100), primary_key=True)
    calibrator_id = Column(String(100), nullable=False)
    store_id = Column(String(50), nullable=False, index=True)
    class_id = Column(String(10), nullable=False, index=True)
    cycle_index = Column(Integer, nullable=False, index=True)
    cycle_start = Column(Date, nullable=False)
    cycle_end = Column(Date, nullable=False)
    n_sku = Column(Integer, default=0)
    n_stockout = Column(Integer, default=0)
    error_rate = Column(Float, default=0.0)
    consumed_at_review = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("idx_service_outcomes", "store_id", "class_id", "cycle_index"),
    )

