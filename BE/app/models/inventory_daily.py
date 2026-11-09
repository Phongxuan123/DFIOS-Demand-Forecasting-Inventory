from datetime import datetime, timezone
from sqlalchemy import Column, String, Date, Float, Boolean, DateTime
from app.models.base import Base

class InventoryDaily(Base):
    __tablename__ = "inventory_daily"

    store_id = Column(String(50), primary_key=True)
    item_id = Column(String(100), primary_key=True)
    date = Column(Date, primary_key=True)
    on_hand_end = Column(Float, default=0.0)
    on_order = Column(Float, default=0.0)
    sales = Column(Float, default=0.0)
    lost_sales = Column(Float, default=0.0)
    stockout = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

