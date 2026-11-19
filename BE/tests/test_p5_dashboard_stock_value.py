"""G-37: dashboard total_inventory_value values stock at the sim-clock-date price (price_history, else products.price, else unit_price):
the same valuation as the Inventory screen."""
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.inventory import Inventory
from app.models.inventory_param import InventoryParam
from app.models.price_history import PriceHistory
from app.models.product import Product
from app.models.sim_clock import SimClock
from app.repositories.dashboard_repository import dashboard_repository

D0, D2 = date(2016, 4, 25), date(2016, 4, 27)


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine, expire_on_commit=False)()
    s.add(SimClock(store_id="CA_1", start_date=D0, current_date=D2))
    for it, price, oh, up in (("FOODS_1_001", 2.0, 3.0, 2.0), ("HOBBIES_1_001", 5.0, 2.0, 5.0),
                              ("FOODS_1_002", 1.0, 4.0, None)):
        s.add(Product(item_id=it, name=it, cat_id=it.split("_")[0], price=price))
        s.add(Inventory(item_id=it, store_id="CA_1", on_hand=oh, on_order=0.0))
        if up is not None:
            s.add(InventoryParam(id=f"p_{it}", item_id=it, store_id="CA_1", unit_price=up, reorder_point=1.0, safety_stock=1.0,
                                 service_level=0.95))
    s.commit()
    yield s
    s.close()
    Base.metadata.drop_all(bind=engine)


def test_no_price_history_keeps_constant_price_value(db):
    # 3*2 + 2*5 + 4*1 (no param row: products.price, the Inventory screen's constant price)
    assert dashboard_repository.get_kpis(db)["total_inventory_value"] == 20.0


def test_price_history_values_stock_at_clock_date_price(db):
    db.add_all([
        PriceHistory(store_id="CA_1", item_id="FOODS_1_001", date=D2, price=3.0),
        PriceHistory(store_id="CA_1", item_id="FOODS_1_001", date=D0, price=9.0),    # not the clock date
        PriceHistory(store_id="CA_1", item_id="FOODS_1_002", date=D2, price=1.5),    # no param row, daily price used
        PriceHistory(store_id="TX_1", item_id="HOBBIES_1_001", date=D2, price=99.0),  # other store: ignored
    ])
    db.commit()
    # 3*3.0 + 2*5 (fallback products.price) + 4*1.5
    assert dashboard_repository.get_kpis(db, store_id="CA_1")["total_inventory_value"] == pytest.approx(25.0)
    assert dashboard_repository.get_kpis(db)["total_inventory_value"] == pytest.approx(25.0)
