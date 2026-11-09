from sqlalchemy import Column, String, Date, Integer
from app.models.base import Base

class Calendar(Base):
    __tablename__ = "calendar"

    date = Column(Date, primary_key=True)
    wm_yr_wk = Column(Integer, nullable=True)
    weekday = Column(String(20), nullable=True)
    wday = Column(Integer, nullable=True)
    month = Column(Integer, nullable=True)
    year = Column(Integer, nullable=True)
    d = Column(String(20), nullable=True)
    event_name_1 = Column(String(100), nullable=True)
    event_type_1 = Column(String(50), nullable=True)
    event_name_2 = Column(String(100), nullable=True)
    event_type_2 = Column(String(50), nullable=True)
    snap_CA = Column(Integer, default=0)
    snap_TX = Column(Integer, default=0)
    snap_WI = Column(Integer, default=0)

