from sqlalchemy import Column, String, Date, Float
from app.models.base import Base

class SalesHistory(Base):
    __tablename__ = "sales_history"

    id = Column(String, primary_key=True)
    item_id = Column(String, nullable=False)
    store_id = Column(String, nullable=False)
    sale_date = Column(Date, primary_key=True)
    quantity = Column(Float, nullable=False)