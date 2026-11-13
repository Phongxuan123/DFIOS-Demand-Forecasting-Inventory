from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, DateTime, SmallInteger, event
from sqlalchemy.schema import Table
from app.models.base import Base

class InventoryParam(Base):
    __tablename__ = "inventory_params"

    id = Column(String, primary_key=True)
    item_id = Column(String, nullable=False, index=True)
    store_id = Column(String, nullable=False, default="CA_1", index=True)
    service_level = Column(Float, nullable=False, default=0.95)
    lead_time_days = Column(SmallInteger, nullable=False, default=7)
    safety_stock = Column(Float, nullable=False, default=0.0)
    reorder_point = Column(Float, nullable=False, default=0.0)
    eoq = Column(Float, nullable=False, default=0.0)
    annual_demand = Column(Float, nullable=False, default=0.0)
    holding_cost = Column(Float, nullable=False, default=2.0)
    order_cost = Column(Float, nullable=False, default=50.0)
    unit_price = Column(Float, nullable=False, default=10.0)
    source = Column(String, nullable=False, default="ml")

    # Extension fields for (R, s, S) and C3-OUT
    s = Column("s", Float, nullable=True)
    S = Column("S", Float, nullable=True)
    model_run_id = Column(String(100), nullable=True, default="c3out-calibrated")

    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

# SQLite treats column names as case-insensitive, so having both "s" and "S" causes
# "duplicate column name: S" during Base.metadata.create_all in SQLite unit tests.
# This event listener temporarily removes "S" during SQLite table creation and restores it after.
_sqlite_temp_cols = {}

@event.listens_for(Table, "before_create")
def _sqlite_case_insensitivity_workaround(target, connection, **kw):
    if connection.dialect.name == "sqlite" and target.name == "inventory_params":
        if "S" in target.columns:
            col = target.columns["S"]
            _sqlite_temp_cols[target.name] = col
            target._columns.remove(col)

@event.listens_for(Table, "after_create")
def _sqlite_case_insensitivity_restore(target, connection, **kw):
    if connection.dialect.name == "sqlite" and target.name in _sqlite_temp_cols:
        target._columns.add(_sqlite_temp_cols.pop(target.name))
