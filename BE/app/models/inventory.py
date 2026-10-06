from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, DateTime
from app.models.base import Base

class Inventory(Base):
    __tablename__ = "inventory"

    item_id = Column(String, primary_key=True)
    store_id = Column(String, primary_key=True)
    on_hand = Column(Float, nullable=False, default=0)
    on_order = Column(Float, nullable=False, default=0)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))