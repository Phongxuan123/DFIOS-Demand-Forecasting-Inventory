import sys
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import text
from app.core.database import engine
from app.models.base import Base
from app.models.calendar import Calendar

load_dotenv(os.path.join(SCRIPT_DIR, "..", ".env"))

# B-17: Đồng bộ DDL với ORM schema (bỏ raw DDL tay gây lệch casing snap_CA vs snap_ca trong PostgreSQL)
Base.metadata.create_all(engine, tables=[Calendar.__table__])

CALENDAR_PATH = os.getenv("M5_CALENDAR_CSV_PATH")
if not CALENDAR_PATH or not os.path.exists(CALENDAR_PATH):
    CALENDAR_PATH = r"C:\m5-forecasting-accuracy\calendar.csv"

if not os.path.exists(CALENDAR_PATH):
    raise SystemExit(f"calendar.csv not found at {CALENDAR_PATH}")

existing_count = pd.read_sql("SELECT COUNT(*) AS c FROM calendar", engine)["c"][0]
if existing_count > 0:
    print(f"Calendar already seeded ({existing_count} records), nothing to do.")
else:
    df = pd.read_csv(CALENDAR_PATH)
    df["date"] = pd.to_datetime(df["date"]).dt.date
    df.to_sql("calendar", engine, if_exists="append", index=False, chunksize=1000, method="multi")
    print(f"Seeded {len(df)} calendar days into database!")
