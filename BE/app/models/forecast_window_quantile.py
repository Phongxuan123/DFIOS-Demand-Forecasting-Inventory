from datetime import datetime, timezone
from sqlalchemy import Column, String, Date, Integer, Float, DateTime, JSON, Index
from app.models.base import Base

class ForecastWindowQuantile(Base):
    __tablename__ = "forecast_window_quantile"

    id = Column(String(100), primary_key=True)
    model_run_id = Column(String(100), nullable=False, index=True)
    store_id = Column(String(50), nullable=False, index=True)
    item_id = Column(String(100), nullable=False, index=True)
    origin_date = Column(Date, nullable=False, index=True)
    horizon_days = Column(Integer, nullable=False, default=10)
    point_window = Column(Float, nullable=False)
    q_levels = Column(JSON, nullable=False)
    route = Column(String(10), default="c")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("idx_fwq_lookup", "model_run_id", "store_id", "item_id", "origin_date"),
    )

