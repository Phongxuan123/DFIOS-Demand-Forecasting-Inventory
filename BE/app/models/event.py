from sqlalchemy import Column, String, Date
from app.models.base import Base

class Event(Base):
    __tablename__ = "events"

    id = Column(String, primary_key=True)
    event_name = Column(String, nullable=False)
    event_date = Column(Date, nullable=False)
    event_type = Column(String)