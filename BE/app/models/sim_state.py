from datetime import datetime, timezone
from sqlalchemy import Column, String, Date, Float, Boolean, DateTime, Index
from app.models.base import Base


class SimSnapshot(Base):
    """Initial inventory of the simulated store at clock start (restored by POST /clock/reset, P-16)."""
    __tablename__ = "sim_snapshot"

    store_id = Column(String(50), primary_key=True)
    item_id = Column(String(100), primary_key=True)
    on_hand = Column(Float, nullable=False, default=0.0)
    on_order = Column(Float, nullable=False, default=0.0)
    as_of_date = Column(Date, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class SimShadowDaily(Base):
    """
    Day-by-day state of the SHADOW baseline B0 (raw quantile tau=0.95, no controller) simulated in parallel
    with the main policy by ``/clock/advance`` (N-03). ``order_qty`` is the quantity ordered at the START of
    that day (arrives L days later). The row of the last day gives the current on_hand/on_order.
    """
    __tablename__ = "sim_shadow_daily"

    store_id = Column(String(50), primary_key=True)
    item_id = Column(String(100), primary_key=True)
    date = Column(Date, primary_key=True)
    on_hand_end = Column(Float, default=0.0)
    on_order = Column(Float, default=0.0)
    sales = Column(Float, default=0.0)
    lost_sales = Column(Float, default=0.0)
    stockout = Column(Boolean, default=False)
    order_qty = Column(Float, default=0.0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (Index("idx_sim_shadow_store_date", "store_id", "date"),)
