import sys
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import text
from app.core.database import engine

load_dotenv(os.path.join(SCRIPT_DIR, "..", ".env"))

with engine.begin() as conn:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS calendar (
            date DATE PRIMARY KEY,
            wm_yr_wk INTEGER,
            weekday VARCHAR(20),
            wday INTEGER,
            month INTEGER,
            year INTEGER,
            d VARCHAR(20),
            event_name_1 VARCHAR(100),
            event_type_1 VARCHAR(50),
            event_name_2 VARCHAR(100),
            event_type_2 VARCHAR(50),
            "snap_CA" INTEGER DEFAULT 0,
            "snap_TX" INTEGER DEFAULT 0,
            "snap_WI" INTEGER DEFAULT 0
        );
    """))

CALENDAR_PATH = os.getenv("M5_CALENDAR_CSV_PATH")
if not CALENDAR_PATH or not os.path.exists(CALENDAR_PATH):
    for candidate in [
        os.path.join(SCRIPT_DIR, "calendar.csv"),
        os.path.join(SCRIPT_DIR, "sample_data", "calendar.csv"),
        os.path.join(SCRIPT_DIR, "..", "data", "calendar.csv"),
    ]:
        if os.path.exists(candidate):
            CALENDAR_PATH = candidate
            break

existing_count = pd.read_sql("SELECT COUNT(*) AS c FROM calendar", engine)["c"][0]
if existing_count > 0:
    print(f"Calendar already seeded ({existing_count} records), nothing to do.")
    sys.exit(0)

if not CALENDAR_PATH or not os.path.exists(CALENDAR_PATH):
    raise SystemExit("calendar.csv not found. Please set M5_CALENDAR_CSV_PATH in BE/.env or place calendar.csv into BE/scripts/sample_data/")
else:
    df = pd.read_csv(CALENDAR_PATH)
    df["date"] = pd.to_datetime(df["date"]).dt.date
    df.to_sql("calendar", engine, if_exists="append", index=False, chunksize=1000, method="multi")
    print(f"Seeded {len(df)} calendar days into database!")
