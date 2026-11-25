"""demo.md §1.3: h, b, c are configured on Settings (only while the clock is on its start date); L, R read-only."""
import unittest
from datetime import date, timedelta

import numpy as np
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.sim_clock import SimClock
from app.services import policy_config as pc
from app.services import simulation_parameters_service as sps
from app.services.policy_backtest import eoq_units

START = date(2025, 11, 24)


def _db(moved=False):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)()
    db.add(SimClock(store_id="CA_1", start_date=START, current_date=START + timedelta(days=7 if moved else 0)))
    db.commit()
    return db


class TestSimulationParameters(unittest.TestCase):
    def tearDown(self):
        pc.apply_costs()  # never leak changed costs into other tests

    def test_defaults_are_the_teacher_values_and_l_r_are_read_only(self):
        out = sps.get_parameters(_db())
        self.assertEqual((out["holding_rate"], out["stockout_penalty_rate"], out["order_cost"]), (0.002, 0.35, 2.0))
        self.assertEqual((out["lead_time_days"], out["review_period_days"], out["horizon_days"]), (3, 7, 10))
        self.assertTrue(out["costs_editable"])

    def test_update_at_day_0_is_stored_and_used_by_the_engine(self):
        db = _db()
        out = sps.update_costs(db, holding_rate=0.004, stockout_penalty_rate=None, order_cost=8.0)
        self.assertEqual((out["holding_rate"], out["stockout_penalty_rate"], out["order_cost"]), (0.004, 0.35, 8.0))
        # EOQ = sqrt(2 c mu / (h p)): c x4 and h x2 -> EOQ x sqrt(2)
        pc.apply_costs()
        base = float(eoq_units(np.array([2.0]), np.array([4.0]))[0])
        pc.sync_costs(db)  # another process reads the stored values
        self.assertAlmostEqual(float(eoq_units(np.array([2.0]), np.array([4.0]))[0]), base * np.sqrt(2.0), places=6)

    def test_locked_once_the_clock_moved_and_range_checked(self):
        with self.assertRaises(HTTPException) as ctx:
            sps.update_costs(_db(moved=True), holding_rate=0.004, stockout_penalty_rate=None, order_cost=None)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertFalse(sps.get_parameters(_db(moved=True))["costs_editable"])
        with self.assertRaises(HTTPException) as ctx:
            sps.update_costs(_db(), holding_rate=None, stockout_penalty_rate=-1.0, order_cost=None)
        self.assertEqual(ctx.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
