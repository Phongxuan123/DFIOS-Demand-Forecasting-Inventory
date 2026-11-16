import sys
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import pandas as pd
from app.core.database import engine
from app.core.db_bulk import replace_rows
from app.models import Base

Base.metadata.create_all(engine)

ARTIFACTS_DIR = os.getenv("DFIOS_ARTIFACTS_DIR") or SCRIPT_DIR
forecast_path = os.path.join(ARTIFACTS_DIR, "production_forecast.parquet")
sigma_path = os.path.join(ARTIFACTS_DIR, "production_sigma.parquet")
for _p in (forecast_path, sigma_path):
    if not os.path.exists(_p):
        raise SystemExit(f"Missing artifact: {_p}. Run `python scripts/check_artifacts.py`.")

MODEL_VERSION = "Ensemble bundle 1.0"

fc = pd.read_parquet(forecast_path).rename(
    columns={"date": "forecast_date", "P10": "p10", "P50": "p50", "P90": "p90"})
fc["model_version"] = MODEL_VERSION
sg = pd.read_parquet(sigma_path)

# Idempotent + atomic: xóa bản cũ rồi COPY trong cùng một transaction.
with engine.begin() as conn:
    replace_rows(conn, "forecast", fc, "DELETE FROM forecast WHERE model_version = :m", {"m": MODEL_VERSION})
    replace_rows(conn, "forecast_sigma", sg, "DELETE FROM forecast_sigma")

print("Load complete!")
