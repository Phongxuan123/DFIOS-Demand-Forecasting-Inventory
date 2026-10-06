from sqlalchemy import Column, String, SmallInteger
from app.models.base import Base

class Supplier(Base):
    __tablename__ = "suppliers"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    lead_time_days = Column(SmallInteger, nullable=False)