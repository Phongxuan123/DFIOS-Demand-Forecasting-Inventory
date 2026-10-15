import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, DateTime
from app.models.base import Base

class ReplenishmentRecommendation(Base):
    __tablename__ = "replenishment_recommendations"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    item_id = Column(String, nullable=False, index=True)
    store_id = Column(String, nullable=False, default="CA_1", index=True)
    supplier_id = Column(String, nullable=True)
    recommended_qty = Column(Float, nullable=False, default=0.0)
    final_qty = Column(Float, nullable=False, default=0.0)
    priority = Column(String, nullable=False, default="MEDIUM")
    status = Column(String, nullable=False, default="PENDING")
    reason = Column(String, nullable=True)
    decided_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    decided_at = Column(DateTime, nullable=True)
