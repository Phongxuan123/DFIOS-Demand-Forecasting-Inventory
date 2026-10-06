from sqlalchemy import Column, String
from app.models.base import Base

class Product(Base):
    __tablename__ = "products"
    
    item_id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    dept_id = Column(String)
    cat_id = Column(String)
