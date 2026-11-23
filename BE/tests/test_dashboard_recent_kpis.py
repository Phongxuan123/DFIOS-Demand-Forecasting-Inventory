"""demo.md §6.2 Dashboard / research.md FR9: fill rate and the classes below the commitment over the last 4 cycles."""
import unittest
from datetime import date, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.inventory_daily import InventoryDaily
from app.models.service_outcomes import ServiceOutcome
from app.services.dashboard_service import DashboardService

START = date(2025, 11, 24)


def _db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)()


def _cycle(db, k, cls, n_sku, n_so, store="CA_1"):
    cs = START + timedelta(days=3 + 7 * k)
    db.add(ServiceOutcome(id=f"{store}_{cls}_{k}", calibrator_id="c", store_id=store, class_id=cls, cycle_index=k,
                          cycle_start=cs, cycle_end=cs + timedelta(days=6), n_sku=n_sku, n_stockout=n_so))


class TestRecentKpis(unittest.TestCase):
    def test_fill_rate_is_sold_over_demanded(self):
        db = _db()
        db.add(InventoryDaily(store_id="CA_1", item_id="A", date=START, sales=90.0, lost_sales=10.0))
        db.add(InventoryDaily(store_id="CA_1", item_id="B", date=START, sales=10.0, lost_sales=0.0))
        db.add(InventoryDaily(store_id="CA_1", item_id="A", date=START + timedelta(days=40), sales=0.0, lost_sales=99.0))
        db.commit()
        self.assertEqual(DashboardService._fill_rate(db, InventoryDaily, ["CA_1"], START, START + timedelta(days=7)),
                         round(100 / 110 * 100, 1))
        self.assertIsNone(DashboardService._fill_rate(db, InventoryDaily, ["TX_1"], START, START))

    def test_classes_below_use_only_the_last_four_closed_cycles(self):
        db = _db()
        # AX: bad in cycle 0 only (dropped from the last 4), fine after -> not below
        _cycle(db, 0, "AX", 100, 50)
        for k in range(1, 5):
            _cycle(db, k, "AX", 100, 1)
        # CX: 1 of 3 SKU out of stock in every cycle -> 66.7% < 95% -> below
        for k in range(5):
            _cycle(db, k, "CX", 3, 1)
        db.commit()
        end = START + timedelta(days=60)
        below, measured, used = DashboardService._classes_below_recent(db, ["CA_1"], START, end, 95.0)
        self.assertEqual((below, measured, used), (1, 2, 4))

    def test_none_before_the_first_closed_cycle(self):
        self.assertEqual(DashboardService._classes_below_recent(_db(), ["CA_1"], START, START, 95.0), (None, None, 0))


if __name__ == "__main__":
    unittest.main()
