from datetime import datetime, timezone
from sqlalchemy import Column, String, SmallInteger, Float, Boolean, Date, DateTime
from app.models.base import Base

class Forecast(Base):
    __tablename__ = "forecast"
    
    id = Column(String, primary_key=True)
    item_id = Column(String, nullable=False)
    store_id = Column(String, nullable=False)
    forecast_date = Column(Date, primary_key=True)
    h = Column(SmallInteger, primary_key=True)
    y_pred = Column(Float, nullable=False)
    p10 = Column(Float)
    p50 = Column(Float)
    p90 = Column(Float)
    available = Column(Boolean, nullable=False)
    model_version = Column(String, nullable=False)
    generated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class ForecastSigma(Base):
    __tablename__ = "forecast_sigma"
    
    id = Column(String, primary_key=True)
    sigma_d_h7 = Column(Float)
    sigma_d_h14 = Column(Float)
    sigma_d_h28 = Column(Float)

class ForecastOverride(Base):
    """
    UC24 - Manual Forecast Override
    Lưu vết can thiệp thủ công giá trị dự báo cho SKU kèm lý do.
    """
    __tablename__ = "forecast_overrides"

    id = Column(String, primary_key=True)
    item_id = Column(String, nullable=False, index=True)
    store_id = Column(String, nullable=False, default="CA_1")
    forecast_date = Column(Date, nullable=False)
    h = Column(SmallInteger, nullable=True)
    original_value = Column(Float, nullable=False)
    override_value = Column(Float, nullable=False)
    reason = Column(String, nullable=False)
    created_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    is_active = Column(Boolean, default=True, nullable=False)

class ForecastExplanation(Base):
    """
    UC23 - Forecast Explanation (SHAP)
    Lưu trữ mức độ đóng góp (feature importance / SHAP) của từng yếu tố đối với dự báo SKU.
    """
    __tablename__ = "forecast_explanations"

    id = Column(String, primary_key=True)
    item_id = Column(String, nullable=False, index=True)
    store_id = Column(String, nullable=False, default="CA_1")
    model_version = Column(String, nullable=False)
    model_name = Column(String, nullable=False, default="lightgbm")
    feature_name = Column(String, nullable=False)
    importance_score = Column(Float, nullable=False)
    direction = Column(String, nullable=True)
    description = Column(String, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
