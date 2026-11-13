import sys
import os
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

from sqlalchemy.orm import sessionmaker
from app.core.database import engine
from app.models.model_registry import ModelRegistry

Session = sessionmaker(bind=engine)
now = datetime.now(timezone.utc)

models = [
    {
        "id": "model-ensemble-v1",
        "name": "Production Ensemble Bundle",
        "version": "v1.0",
        "algorithm": "ensemble",
        "scope": "global",
        "is_production": True,
        "parameters": {
            "components": ["LightGBM", "XGBoost", "LSTM", "TFT"],
            "weights": {"LightGBM": 0.441, "XGBoost": 0.078, "LSTM": 0.0, "TFT": 0.481}
        },
        "metrics": {
            "wrmsse": 0.4935,
            "mase": 0.975
        },
        "trained_by": "DFIOS ML Pipeline",
        "job_id": None,
        "created_at": now,
        "promoted_at": now
    },
    {
        "id": "model-tft-v1",
        "name": "TFT Seasonal Model",
        "version": "v1.0",
        "algorithm": "tft",
        "scope": "global",
        "is_production": False,
        "parameters": {
            "hidden_size": 64,
            "attention_heads": 4,
            "dropout": 0.1,
            "learning_rate": 0.001
        },
        "metrics": {
            "mae": 0.948,
            "wrmsse": 0.5004
        },
        "trained_by": "DFIOS ML Pipeline",
        "job_id": None,
        "created_at": now,
        "promoted_at": None
    },
    {
        "id": "model-lightgbm-v1",
        "name": "LightGBM Baseline",
        "version": "v1.0",
        "algorithm": "lightgbm",
        "scope": "global",
        "is_production": False,
        "parameters": {
            "n_estimators": 500,
            "learning_rate": 0.03,
            "num_leaves": 31,
            "max_depth": 6
        },
        "metrics": {
            "wrmsse": 0.5083
        },
        "trained_by": "DFIOS ML Pipeline",
        "job_id": None,
        "created_at": now,
        "promoted_at": None
    },
    {
        "id": "model-sarima-v1",
        "name": "Seasonal ARIMA",
        "version": "v1.0",
        "algorithm": "sarima",
        "scope": "global",
        "is_production": False,
        "parameters": {
            "order": [1, 1, 1],
            "seasonal_order": [1, 1, 1, 7]
        },
        "metrics": {
            "mase": 1.12,
            "wrmsse": 1.05
        },
        "trained_by": "DFIOS ML Pipeline",
        "job_id": None,
        "created_at": now,
        "promoted_at": None
    }
]

with Session() as session:
    existing = session.query(ModelRegistry).count()
    if existing > 0:
        print("Model registry already seeded, nothing to do.")
    else:
        for m in models:
            session.add(ModelRegistry(**m))
        session.commit()
        print(f"Seeded {len(models)} model_registry records!")
