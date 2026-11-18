"""Daily selling price per (store, item, date) (G-37).

The teacher prices every simulated day with the daily ``price.npy``; the app keeps the constant ``products.price``
as the fallback. When rows exist for a (store, item, date) that day's price is used by the engine (EOQ at the review
day, J5 candidate costs: holding = end-of-day stock * price of that day, lost units * price of that day); otherwise
``products.price``. An empty table makes the feature a no-op.
"""
from sqlalchemy import Column, Date, Float, Index, String

from app.models.base import Base


class PriceHistory(Base):
    __tablename__ = "price_history"

    store_id = Column(String(50), primary_key=True)
    item_id = Column(String(100), primary_key=True)
    date = Column(Date, primary_key=True)
    price = Column(Float, nullable=False)

    __table_args__ = (Index("ix_price_history_store_date_item", "store_id", "date", "item_id"),)
