import sys
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import pandas as pd
from app.database import engine
from app.models import Base

Base.metadata.create_all(engine)

forecast_path = os.path.join(SCRIPT_DIR, "production_forecast.parquet")
sigma_path = os.path.join(SCRIPT_DIR, "production_sigma.parquet")

fc = pd.read_parquet(forecast_path).rename(
    columns={"date": "forecast_date", "P10": "p10", "P50": "p50", "P90": "p90"})
fc["model_version"] = "Ensemble bundle 1.0"
fc.to_sql("forecast", engine, if_exists="append", index=False,
          chunksize=20_000, method="multi")

sg = pd.read_parquet(sigma_path)
sg.to_sql("forecast_sigma", engine, if_exists="append", index=False)

print("Load complete!")