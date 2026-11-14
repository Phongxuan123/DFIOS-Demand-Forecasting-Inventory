from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Float, DateTime, Index
from app.models.base import Base


class ForecastBacktest(Base):
    """
    Bảng lưu trữ dự báo backtest nhân quả (causal forecasts) phục vụ Route (c) và Tier 2 / Tier 3.
    """
    __tablename__ = "forecast_backtest"

    id = Column(String(100), primary_key=True)
    store_id = Column(String(50), nullable=False, index=True)
    item_id = Column(String(100), nullable=False, index=True)
    review_day = Column(Integer, nullable=False, index=True)
    dhat = Column(Float, nullable=False)
    dhat_lgb = Column(Float, nullable=False)
    sigma_d = Column(Float, nullable=False)
    model_run = Column(String(50), default="backtest-ensemble-v1", index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("idx_fc_backtest_lookup", "store_id", "item_id", "review_day"),
    )
