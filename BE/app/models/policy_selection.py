from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, Boolean, DateTime
from app.models.base import Base

class PolicySelection(Base):
    __tablename__ = "policy_selection"

    selection_id = Column(String(100), primary_key=True)
    class_id = Column(String(10), primary_key=True)
    policy_type = Column(String(50), default="REFIT_RSS_EOQ_G")
    m_g = Column(Float, default=0.0)
    kappa_g = Column(Float, default=1.0)
    tau = Column(Float, default=0.95)
    setpoint = Column(Float, default=0.96)
    guard = Column(Float, default=0.01)
    gain_eta = Column(Float, default=1.0)
    val_cost = Column(Float, nullable=True)
    val_service = Column(Float, nullable=True)
    is_feasible = Column(Boolean, default=True)
    econ_service = Column(Float, default=0.95)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

