from datetime import datetime, timezone

from sqlalchemy import REAL, Column, Date, DateTime, String

from app.models.base import Base


class ForecastDailyBacktest(Base):
    """Daily backtest point forecasts of the backtest engine (demo.md §4.3 step 6, §2 "Backtest engine").

    One row per (model_run, store, origin, SKU) with the 14 horizons as columns ``y_h1 .. y_h14`` (the array form
    demo.md asks for instead of one row per horizon). Origin ``o`` forecasts the days ``o .. o + 13`` from data before
    ``o`` only (rolling origin, the teacher's ``daily_points.npz``), so ``y_h1`` of origin D is the forecast of day D
    made the evening before. Loaded once by ``scripts/load_teacher_data.py --steps daily`` into the local sandbox; the
    engine never reads it (J3/J4 use the window quantiles), it feeds the "actual vs forecast" charts in replay.
    """
    __tablename__ = "forecast_daily_backtest"

    model_run = Column(String(50), primary_key=True)      # e.g. backtest-ensemble-v1
    store_id = Column(String(50), primary_key=True)
    origin_date = Column(Date, primary_key=True)
    item_id = Column(String(100), primary_key=True)
    y_h1 = Column(REAL, nullable=False)
    y_h2 = Column(REAL, nullable=False)
    y_h3 = Column(REAL, nullable=False)
    y_h4 = Column(REAL, nullable=False)
    y_h5 = Column(REAL, nullable=False)
    y_h6 = Column(REAL, nullable=False)
    y_h7 = Column(REAL, nullable=False)
    y_h8 = Column(REAL, nullable=False)
    y_h9 = Column(REAL, nullable=False)
    y_h10 = Column(REAL, nullable=False)
    y_h11 = Column(REAL, nullable=False)
    y_h12 = Column(REAL, nullable=False)
    y_h13 = Column(REAL, nullable=False)
    y_h14 = Column(REAL, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


DAILY_HORIZONS = 14
