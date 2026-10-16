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
        "id": "model-tft-v1",
        "name": "TFT Seasonal Model",
        "version": "v1.0",
        "algorithm": "tft",
        "scope": "global",
        "is_production": True,
        "parameters": {
            "hidden_size": 64,
            "attention_heads": 4,
            "dropout": 0.1,
            "learning_rate": 0.001
        },
        "metrics": {
            "mae": 3.92,
            "rmse": 4.81,
            "mase": 0.64,
            "wrmsse": 0.58
        },
        "trained_by": "Kim Anh (Data Engineer)",
        "job_id": None,
        "created_at": now,
        "promoted_at": now
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
            "mae": 4.41,
            "rmse": 5.62,
            "mase": 0.78,
            "wrmsse": 0.71
        },
        "trained_by": "Kim Anh (Data Engineer)",
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
            "mae": 6.72,
            "rmse": 8.43,
            "mase": 1.12,
            "wrmsse": 1.05
        },
        "trained_by": "Kim Anh (Data Engineer)",
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
