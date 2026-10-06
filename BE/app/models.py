from sqlalchemy import Column, String, SmallInteger, Float, Boolean, Date, DateTime
from sqlalchemy.orm import declarative_base
from datetime import datetime

Base = declarative_base()

class Forecast(Base):
    __tablename__ = "forecast"
    id = Column(String, primary_key=True)
    item_id = Column(String, nullable=False)
    store_id = Column(String, nullable=False)
    forecast_date = Column(Date, primary_key=True)
    h = Column(SmallInteger, primary_key=True)
    y_pred = Column(Float, nullable=False)
    p10 = Column(Float)
    p50 = Column(Float)
    p90 = Column(Float)
    available = Column(Boolean, nullable=False)
    model_version = Column(String, nullable=False)
    generated_at = Column(DateTime, default=datetime.utcnow)

class ForecastSigma(Base):
    __tablename__ = "forecast_sigma"
    id = Column(String, primary_key=True)
    sigma_d_h7 = Column(Float)
    sigma_d_h14 = Column(Float)
    sigma_d_h28 = Column(Float)
    
class Product(Base):
    __tablename__ = "products"
    item_id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    dept_id = Column(String)
    cat_id = Column(String)

class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False)  # "Admin" | "Warehouse Manager" | "Viewer"
    display_name = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    
class SalesHistory(Base):
    __tablename__ = "sales_history"
    id = Column(String, primary_key=True)
    item_id = Column(String, nullable=False)
    store_id = Column(String, nullable=False)
    sale_date = Column(Date, primary_key=True)
    quantity = Column(Float, nullable=False)

class Supplier(Base):
    __tablename__ = "suppliers"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    lead_time_days = Column(SmallInteger, nullable=False)

class Inventory(Base):
    __tablename__ = "inventory"
    item_id = Column(String, primary_key=True)
    store_id = Column(String, primary_key=True)
    on_hand = Column(Float, nullable=False, default=0)
    on_order = Column(Float, nullable=False, default=0)
    updated_at = Column(DateTime, default=datetime.utcnow)

class Event(Base):
    __tablename__ = "events"
    id = Column(String, primary_key=True)
    event_name = Column(String, nullable=False)
    event_date = Column(Date, nullable=False)
    event_type = Column(String)