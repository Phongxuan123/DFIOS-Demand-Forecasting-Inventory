"""demo.md §4.3 step 6 / §1 causality: the replay "actual vs forecast" chart reads the daily backtest forecasts.

* past days (<= clock) get the h = 1 forecast of the origin equal to that day (made the evening before);
* days after the clock get the path of the latest origin <= clock + 1, never a later origin;
* the production run (origin after the clock) stays hidden; a store without daily backtest rows keeps the old path.
"""
import os
import sys
import unittest
from datetime import date, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.forecast import Forecast
from app.models.forecast_daily_backtest import ForecastDailyBacktest as FDB
from app.models.product import Product
from app.models.sales_history import SalesHistory
from app.models.sim_clock import SimClock
from app.services.dashboard_service import dashboard_service

START = date(2025, 11, 24)
CLOCK = START + timedelta(days=10)
ITEMS = (("FOODS_1_001", "FOODS", "FOODS_1"), ("HOBBIES_1_001", "HOBBIES", "HOBBIES_1"))
RUN = "backtest-ensemble-v1"


def _value(item_idx: int, origin: date, h: int) -> float:
    """A distinct forecast per (item, origin, h): origin offset * 100 + h, + 1000 for the second item."""
    return 1000.0 * item_idx + 100.0 * (origin - START).days + h


def _db(with_daily=True):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)()
    db.add(SimClock(store_id="CA_1", current_date=CLOCK, start_date=START))
    for i, (it, cat, dept) in enumerate(ITEMS):
        db.add(Product(item_id=it, name=it, cat_id=cat, dept_id=dept, price=1.0))
        for d in range(-5, 30):
            day = START + timedelta(days=d)
            db.add(SalesHistory(id=f"s{i}_{d}", item_id=it, store_id="CA_1", sale_date=day, quantity=3.0))
            if with_daily:
                db.add(FDB(model_run=RUN, store_id="CA_1", origin_date=day, item_id=it,
                           **{f"y_h{h}": _value(i, day, h) for h in range(1, 15)}))
    # the production run of 2026: must never show in replay
    db.add(Forecast(id="p1", item_id="FOODS_1_001", store_id="CA_1", forecast_date=date(2026, 11, 23), h=1,
                    y_pred=999.0, available=True, model_version="Ensemble bundle 1.0"))
    db.commit()
    return db


class TestBacktestDailyTrend(unittest.TestCase):
    def test_past_days_use_h1_of_the_same_day_origin(self):
        db = _db()
        out = dashboard_service.get_demand_trend(db, store_id="CA_1", days=7)
        past = [p for p in out.data if p.date <= str(CLOCK)]
        self.assertEqual(len(past), 7)
        for p in past:
            d = date.fromisoformat(p.date)
            self.assertEqual(p.actual, 6.0)
            self.assertAlmostEqual(p.predicted, _value(0, d, 1) + _value(1, d, 1), places=1)
        self.assertEqual(out.forecast_source, RUN)
        self.assertEqual(out.forecast_past_horizon, 1)
        self.assertIsNone(out.forecast_note)

    def test_future_days_come_from_the_origin_clock_plus_one_only(self):
        db = _db()
        out = dashboard_service.get_demand_trend(db, store_id="CA_1", days=7)
        future = [p for p in out.data if p.date > str(CLOCK)]
        self.assertEqual(len(future), 14)
        origin = CLOCK + timedelta(days=1)
        for k, p in enumerate(future, start=1):
            self.assertEqual(p.date, str(CLOCK + timedelta(days=k)))
            self.assertIsNone(p.actual)  # no sales after the clock
            self.assertAlmostEqual(p.predicted, _value(0, origin, k) + _value(1, origin, k), places=1)
        self.assertEqual(out.forecast_as_of, str(CLOCK))
        self.assertTrue(all(p.predicted != 999.0 for p in out.data))

    def test_no_origin_after_the_clock_is_read(self):
        """Changing every row with origin > clock + 1 must not change the response (causality)."""
        db = _db()
        before = [(p.date, p.predicted) for p in dashboard_service.get_demand_trend(db, store_id="CA_1", days=7).data]
        for row in db.query(FDB).filter(FDB.origin_date > CLOCK + timedelta(days=1)).all():
            for h in range(1, 15):
                setattr(row, f"y_h{h}", 77777.0)
        db.commit()
        after = [(p.date, p.predicted) for p in dashboard_service.get_demand_trend(db, store_id="CA_1", days=7).data]
        self.assertEqual(before, after)

    def test_category_filter(self):
        db = _db()
        out = dashboard_service.get_demand_trend(db, store_id="CA_1", category="HOBBIES", days=3)
        p = next(p for p in out.data if p.date == str(CLOCK))
        self.assertEqual(p.actual, 3.0)
        self.assertAlmostEqual(p.predicted, _value(1, CLOCK, 1), places=1)

    def test_last_origin_before_the_clock_when_the_file_ends(self):
        db = _db()
        db.query(FDB).filter(FDB.origin_date > CLOCK - timedelta(days=2)).delete()
        db.commit()
        out = dashboard_service.get_demand_trend(db, store_id="CA_1", days=7)
        last = CLOCK - timedelta(days=2)   # latest origin left: forecasts days last .. last + 13
        future = [p for p in out.data if p.date > str(CLOCK)]
        self.assertEqual(len(future), 14 - 3)
        self.assertEqual(out.forecast_as_of, str(last - timedelta(days=1)))
        self.assertAlmostEqual(future[0].predicted, _value(0, last, 4) + _value(1, last, 4), places=1)
        # past days without an origin have no forecast (never filled from a later origin)
        self.assertIsNone(next(p for p in out.data if p.date == str(CLOCK)).predicted)

    def test_store_without_daily_rows_keeps_hiding_the_production_run(self):
        db = _db(with_daily=False)
        out = dashboard_service.get_demand_trend(db, store_id="CA_1", days=7)
        self.assertTrue(all(p.predicted is None for p in out.data))
        self.assertIsNone(out.forecast_source)
        self.assertIn("hidden", out.forecast_note)


class TestLoadDailyPoints(unittest.TestCase):
    def test_loader_stores_the_store_rows_and_origin_range(self):
        import tempfile
        import numpy as np
        import pandas as pd

        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import load_teacher_data as ltd

        engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=engine)
        db = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
        with tempfile.TemporaryDirectory() as td_dir:
            fdir = os.path.join(td_dir, *ltd.DAILY_POINTS_SUBPATH[:-1])
            os.makedirs(fdir)
            origins = np.arange(100, 110)
            arr = np.arange(10 * 3 * 14, dtype=np.float32).reshape(10, 3, 14)
            np.savez_compressed(os.path.join(fdir, "daily_points.npz"), origins=origins, ensemble=arr)
            td = {"store": "CA_1", "slice": slice(1, 3),
                  "meta": pd.DataFrame({"item_id": ["A", "B"]})}
            rep = ltd.load_daily_points(db, td, td_dir, ["ensemble"], first_origin=105)
        self.assertEqual(rep["ensemble"]["rows"], 5 * 2)
        self.assertEqual(rep["ensemble"]["model_run"], RUN)
        row = db.query(FDB).filter(FDB.item_id == "B", FDB.origin_date == ltd.day_to_date(107)).one()
        self.assertEqual(row.y_h1, float(arr[7, 2, 0]))
        self.assertEqual(row.y_h14, float(arr[7, 2, 13]))
        self.assertEqual(db.query(FDB).filter(FDB.origin_date < ltd.day_to_date(105)).count(), 0)


if __name__ == "__main__":
    unittest.main()
