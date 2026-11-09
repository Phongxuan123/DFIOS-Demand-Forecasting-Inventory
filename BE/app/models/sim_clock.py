from datetime import datetime, timezone
from sqlalchemy import Column, String, Date, Float, DateTime
from app.models.base import Base

class SimClock(Base):
    __tablename__ = "sim_clock"

    store_id = Column(String(50), primary_key=True)
    current_date = Column("current_date", Date, nullable=False)
    start_date = Column(Date, nullable=False)
    mode = Column(String(20), default="replay")
    speed = Column(Float, default=1.0)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

