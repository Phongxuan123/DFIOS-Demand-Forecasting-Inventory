"""
Per-model window quantiles kept as SOURCES for the model switch (demo.md §7 step 10, teacher E9c).

The engine (J3 / J4 / J5) reads ONE series of window quantiles: ``forecast_window_quantile`` rows of the default
model run. ``window_quantile_source`` keeps, per forecasting model (``ensemble``, ``chronos_bolt``, ...), that model's
own Q_{L+R} at every review origin; nothing in the engine reads it. Activating a model copies its source rows into
the engine series for the review origins AFTER the simulated clock (decisions already taken never change), and each
copied row records the model in ``forecast_window_quantile.source_model``. ``window_model_activation`` logs every
activation (who, when, from which day, how many rows). A rollback is an activation of the previous model.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Column, Date, DateTime, Float, Index, Integer, String

from app.models.base import Base


class WindowQuantileSource(Base):
    __tablename__ = "window_quantile_source"

    id = Column(String(160), primary_key=True)
    store_id = Column(String(50), nullable=False)
    model = Column(String(40), nullable=False)
    item_id = Column(String(100), nullable=False)
    origin_date = Column(Date, nullable=False)
    horizon_days = Column(Integer, nullable=False, default=10)
    point_window = Column(Float, nullable=False)
    q_levels = Column(JSON, nullable=False)
    source_dir = Column(String(255), nullable=True)   # where the model's Q_H file was read (provenance)

    __table_args__ = (Index("idx_wqs_lookup", "store_id", "model", "horizon_days", "origin_date"),)


class WindowModelActivation(Base):
    __tablename__ = "window_model_activation"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    store_id = Column(String(50), nullable=False, index=True)
    model = Column(String(40), nullable=False)
    previous_model = Column(String(40), nullable=True)
    from_date = Column(Date, nullable=False)       # first review origin served by the model
    n_origins = Column(Integer, nullable=False, default=0)
    n_rows = Column(Integer, nullable=False, default=0)
    activated_by = Column(String(120), nullable=True)
    activated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), index=True)
