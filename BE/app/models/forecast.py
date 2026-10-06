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
