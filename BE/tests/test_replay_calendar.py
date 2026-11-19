"""A replay database shifted as a whole (scripts/shift_sandbox_calendar.py) keeps its own calendar: the anchor of
M5 d_1 is read from the ``replay_calendar`` system setting; any other database keeps 2011-01-29."""
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.system_setting import SystemSetting
from app.services import policy_config as pc


def _db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def test_default_calendar_without_the_setting():
    db = _db()
    try:
        assert pc.load_calendar_setting(db) == date(2011, 1, 29)
        assert pc.date_to_day_index(date(2015, 5, 25)) == 1577
    finally:
        pc.set_m5_day0(pc.M5_DAY0_DEFAULT)
        db.close()


def test_shifted_calendar_maps_the_same_day_indices_to_shifted_dates():
    db = _db()
    db.add(SystemSetting(key=pc.CALENDAR_SETTING_KEY, value={"m5_day0": "2021-07-31", "shift_days": 3836}))
    db.commit()
    try:
        assert pc.load_calendar_setting(db) == date(2021, 7, 31)
        # the first test day d_1578 (index 1577) is a Monday on both calendars
        assert pc.day_index_to_date(1577) == date(2025, 11, 24)
        assert pc.date_to_day_index(date(2025, 11, 24)) == 1577
        assert pc.day_index_to_date(1577).weekday() == date(2015, 5, 25).weekday() == 0
    finally:
        pc.set_m5_day0(pc.M5_DAY0_DEFAULT)
        db.close()


def test_unreadable_setting_keeps_the_m5_calendar():
    db = _db()
    db.add(SystemSetting(key=pc.CALENDAR_SETTING_KEY, value={"m5_day0": "not a date"}))
    db.commit()
    try:
        assert pc.load_calendar_setting(db) == pc.M5_DAY0_DEFAULT
    finally:
        pc.set_m5_day0(pc.M5_DAY0_DEFAULT)
        db.close()
