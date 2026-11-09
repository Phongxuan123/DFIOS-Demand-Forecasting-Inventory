from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Date, Float, Boolean, DateTime, Index
from app.models.base import Base

class CalibrationState(Base):
    __tablename__ = "calibration_state"

    id = Column(String(100), primary_key=True)
    calibrator_id = Column(String(100), nullable=False)
    store_id = Column(String(50), nullable=False, index=True)
    class_id = Column(String(10), nullable=False, index=True)
    review_index = Column(Integer, nullable=False, index=True)
    review_date = Column(Date, nullable=False)
    theta = Column(Float, default=0.0)
    multiplier = Column(Float, default=1.0)
    error_rate = Column(Float, default=0.04)
    at_boundary = Column(Boolean, default=False)
    setpoint = Column(Float, default=0.96)
    eta = Column(Float, default=1.0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("idx_calib_state", "store_id", "class_id", "review_index"),
    )

