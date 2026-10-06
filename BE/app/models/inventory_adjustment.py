from datetime import datetime, timezone
import uuid
from sqlalchemy import Column, String, Float, DateTime, ForeignKey, Text
from app.models.base import Base


class InventoryAdjustment(Base):
    """
    Model ghi nhận lịch sử điều chỉnh số liệu tồn kho (UC14).
    """
    __tablename__ = "inventory_adjustments"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    item_id = Column(String, ForeignKey("products.item_id"), nullable=False, index=True)
    store_id = Column(String, nullable=False, index=True)
    old_on_hand = Column(Float, nullable=False)
    new_on_hand = Column(Float, nullable=False)
    old_on_order = Column(Float, nullable=False)
    new_on_order = Column(Float, nullable=False)
    reason = Column(Text, nullable=True)
    adjusted_by = Column(String, nullable=True, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
