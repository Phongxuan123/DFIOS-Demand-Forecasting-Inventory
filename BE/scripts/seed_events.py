import sys, os, uuid
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import pandas as pd
from app.database import engine

CALENDAR_PATH = r"C:\m5-forecasting-accuracy\calendar.csv"

df = pd.read_csv(CALENDAR_PATH, usecols=["date", "event_name_1", "event_type_1", "event_name_2", "event_type_2"])

events = []
for _, row in df.iterrows():
    if pd.notna(row["event_name_1"]):
        events.append({"id": str(uuid.uuid4()), "event_name": row["event_name_1"],
                        "event_date": row["date"], "event_type": row["event_type_1"]})
    if pd.notna(row["event_name_2"]):
        events.append({"id": str(uuid.uuid4()), "event_name": row["event_name_2"],
                        "event_date": row["date"], "event_type": row["event_type_2"]})

events_df = pd.DataFrame(events)

existing = pd.read_sql("SELECT count(*) as c FROM events", engine)["c"][0]
if existing > 0:
    print("Events already seeded, nothing to do.")
else:
    events_df.to_sql("events", engine, if_exists="append", index=False)
    print(f"Seeded {len(events_df)} events!")