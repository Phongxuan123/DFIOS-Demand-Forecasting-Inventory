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
            "mase": 0.9753,
            "mae": 0.9467,
            "rmse": 1.8509,
            "metrics_source": {k: "artifact:MODEL/best_params.json test_metrics h=7d" for k in ("wrmsse", "mase", "mae", "rmse")},
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
            "mae": None,
            "wrmsse": 0.5004,
            "mase": None,
            "rmse": None,
            "metrics_source": {"wrmsse": "artifact:c3ok Result OK (h=7)", "mae": "unsourced", "mase": "unsourced", "rmse": "unsourced"},
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
            "wrmsse": 0.5083,
            "mae": None,
            "mase": None,
            "rmse": None,
            "metrics_source": {"wrmsse": "artifact:c3ok Result OK (h=7)", "mae": "unsourced", "mase": "unsourced", "rmse": "unsourced"},
        },
        "trained_by": "DFIOS ML Pipeline",
        "job_id": None,
        "created_at": now,
        "promoted_at": None
    },
    {
        # demo.md §4.1 / §7 step 3: the BACKTEST engine that feeds the replay (scope "replay", never production:
        # the dashboard's production model is the bundle above). Numbers: DFIOS/reports/experiment_results.md §2,
        # Bảng 1 (test origins 1577-1927, h = 1..14, revenue weights).
        "id": "model-backtest-ensemble-v1",
        "name": "Backtest Ensemble (replay)",
        "version": "v1",
        "algorithm": "ensemble",
        "scope": "replay",
        "is_production": False,
        "parameters": {
            "model_run": "backtest-ensemble-v1",
            "components": ["LightGBM", "XGBoost", "MLP"],
            "weights": {"LightGBM": 0.548, "XGBoost": 0.275, "MLP": 0.202},
            "features": 29,
            "cutoffs": {"model_A": "d_1031", "model_B": "d_1395"},
            "origins": "rolling-origin d_1031 .. d_1940 (910), h = 1..14",
            "panel": "P-Main: CA_1, TX_1, WI_1 (8,831 series)",
            "source_file": "results/forecasts/daily_points.npz",
        },
        "metrics": {
            "wrmsse": 0.769,
            "mase": 0.920,
            "mae": None,
            "rmse": None,
            "bias_pct": -0.1,
            "metrics_source": {
                "wrmsse": "artifact:experiment_results.md Bảng 1 WRMSSE (SKU) h=1..14",
                "mase": "artifact:experiment_results.md Bảng 1 WMASE (SKU) h=1..14",
                "mae": "unsourced",
                "rmse": "unsourced",
            },
        },
        "trained_by": "DFIOS ML Pipeline (E1/G1)",
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
            "mase": None,
            "wrmsse": None,
            "mae": None,
            "rmse": None,
            "metrics_source": {k: "unsourced - no SARIMA run exists in the artifacts" for k in ("wrmsse", "mase", "mae", "rmse")},
        },
        "trained_by": "DFIOS ML Pipeline",
        "job_id": None,
        "created_at": now,
        "promoted_at": None
    }
]

with Session() as session:
    for m in models:
        existing = session.query(ModelRegistry).filter(ModelRegistry.id == m["id"]).first()
        if existing:
            for k, v in m.items():
                setattr(existing, k, v)
        else:
            session.add(ModelRegistry(**m))
    session.commit()
    print("Successfully synchronized model_registry with actual M5 scientific benchmarks!")
