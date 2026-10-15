from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, DateTime, SmallInteger
from app.models.base import Base

class InventoryParam(Base):
    __tablename__ = "inventory_params"

    id = Column(String, primary_key=True)
    item_id = Column(String, nullable=False, index=True)
    store_id = Column(String, nullable=False, default="CA_1", index=True)
    service_level = Column(Float, nullable=False, default=0.95)
    lead_time_days = Column(SmallInteger, nullable=False, default=7)
    safety_stock = Column(Float, nullable=False, default=0.0)
    reorder_point = Column(Float, nullable=False, default=0.0)
    eoq = Column(Float, nullable=False, default=0.0)
    annual_demand = Column(Float, nullable=False, default=0.0)
    holding_cost = Column(Float, nullable=False, default=2.0)
    order_cost = Column(Float, nullable=False, default=50.0)
    unit_price = Column(Float, nullable=False, default=10.0)
    source = Column(String, nullable=False, default="ml")
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
