import os
import json
import math
import logging
import pandas as pd
import numpy as np
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)


class DFIOSPredictor:
    """
    Wrapper tích hợp Production Engine Bundle (Task PRE.1):
    - Đọc và kiểm định manifest của Ensemble Bundle 1.0 (LightGBM, XGBoost, TFT, LSTM).
    - Quản lý trọng số kết hợp (NNLS weights) và các siêu tham số mô hình.
    - Cung cấp phương thức suy luận dự báo trực tiếp 28 ngày tương lai (h = 1..28).
    """

    def __init__(self, model_dir: Optional[str] = None):
        if not model_dir:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            model_dir = os.path.join(base_dir, "..", "..", "MODEL")
        
        self.model_dir = os.path.abspath(model_dir)
        self.manifest_path = os.path.join(self.model_dir, "ensemble_manifest.json")
        self.best_params_path = os.path.join(self.model_dir, "best_params.json")
        self.manifest: Dict[str, Any] = {}
        self.weights: Dict[str, float] = {}
        self.is_loaded: bool = False
        self._prod_df: Optional[pd.DataFrame] = None
        self._load_metadata()

    def _load_metadata(self) -> None:
        """
        Nạp metadata, manifest và trọng số của các thành phần trong bundle.
        """
        if os.path.exists(self.manifest_path):
            try:
                with open(self.manifest_path, "r", encoding="utf-8") as f:
                    self.manifest = json.load(f)
                self.weights = self.manifest.get("weights", {
                    "LightGBM": 0.441,
                    "XGBoost": 0.078,
                    "LSTM": 0.0,
                    "TFT": 0.481,
                })
                self.is_loaded = True
                logger.info(f"DFIOSPredictor: Loaded ensemble bundle from {self.model_dir}")
            except Exception as e:
                logger.warning(f"DFIOSPredictor: Failed to parse manifest: {e}")
        else:
            logger.warning(f"DFIOSPredictor: Manifest not found at {self.manifest_path}")

    def _load_production_forecasts(self) -> Optional[pd.DataFrame]:
        """
        R-14: Nạp dữ liệu dự báo 28 ngày thực tế từ production_forecast.parquet (16.35 MB).
        """
        if self._prod_df is not None:
            return self._prod_df
        base_dir = os.path.dirname(os.path.abspath(__file__))
        be_dir = os.path.abspath(os.path.join(base_dir, "..", ".."))
        candidates = [
            os.path.join(be_dir, "scripts", "production_forecast.parquet"),
            os.path.join(be_dir, "MODEL", "production_forecast.parquet"),
        ]
        for p in candidates:
            if os.path.exists(p):
                try:
                    self._prod_df = pd.read_parquet(p)
                    logger.info(f"DFIOSPredictor: Loaded {len(self._prod_df)} production forecasts from {p}")
                    return self._prod_df
                except Exception as e:
                    logger.warning(f"DFIOSPredictor: Failed to load {p}: {e}")
        return None

    def get_bundle_info(self) -> Dict[str, Any]:
        """
        Trả về thông tin chi tiết của production ensemble bundle cho màn hình Model versions.
        """
        return {
            "version": "dfios_forecast v1.0",
            "type": self.manifest.get("type", "ensemble"),
            "method": self.manifest.get("method", "nnls_on_validation"),
            "components": self.manifest.get("components", ["LightGBM", "XGBoost", "LSTM", "TFT"]),
            "weights": self.weights,
            "status": "ACTIVE" if self.is_loaded else "STANDBY",
            "model_dir": self.model_dir,
        }

    def predict_sku_future(
        self,
        item_id: str,
        store_id: str = "CA_1",
        horizon: int = 28,
        df_production_source: Optional[pd.DataFrame] = None,
        db: Optional[Any] = None,
    ) -> List[Dict[str, Any]]:
        """
        R-14: Dự báo tương lai 28 ngày cho một SKU cụ thể (Production Engine dfios_forecast v1.0).
        - Ưu tiên đọc từ production_forecast.parquet thực tế của Ensemble Bundle.
        - Nếu SKU mới không có trong artifact, tự động suy luận qua SBA từ lịch sử bán hàng thực tế.
          Tuyệt đối không hardcode hằng số 1.5.
        """
        source_df = df_production_source if df_production_source is not None else self._load_production_forecasts()
        if source_df is not None and not source_df.empty:
            sub = source_df[
                (source_df["item_id"] == item_id) &
                (source_df["store_id"] == store_id)
            ].sort_values("h")
            if not sub.empty:
                records = []
                for _, r in sub.head(horizon).iterrows():
                    records.append({
                        "item_id": item_id,
                        "store_id": store_id,
                        "h": int(r["h"]),
                        "y_pred": round(float(r["y_pred"]), 3),
                        "p10": round(float(r.get("P10", r.get("p10", max(0.0, r["y_pred"] * 0.7)))), 3),
                        "p50": round(float(r.get("P50", r.get("p50", r["y_pred"]))), 3),
                        "p90": round(float(r.get("P90", r.get("p90", r["y_pred"] * 1.3))), 3),
                        "available": bool(r.get("available", True)),
                        "model_version": "dfios_forecast v1.0",
                    })
                return records

        # Nếu không có trong production_forecast, suy luận bằng SBA từ sales_history thực tế
        if db is not None:
            from app.models.sales_history import SalesHistory
            from app.services.fast_inference_service import fast_inference_service
            sales_rows = (
                db.query(SalesHistory.quantity)
                .filter(SalesHistory.item_id == item_id, SalesHistory.store_id == store_id)
                .order_by(SalesHistory.sale_date.asc())
                .all()
            )
            if sales_rows:
                quantities = np.array([float(r[0]) for r in sales_rows])
                base_rate, std_est = fast_inference_service.sba_croston_forecast(quantities, horizon=horizon)
                records = []
                for h in range(1, horizon + 1):
                    y_pred = round(base_rate, 3)
                    p10 = round(max(0.0, y_pred - 1.282 * std_est * math.sqrt(h / 7.0)), 3)
                    p50 = y_pred
                    p90 = round(y_pred + 1.282 * std_est * math.sqrt(h / 7.0), 3)
                    records.append({
                        "item_id": item_id,
                        "store_id": store_id,
                        "h": h,
                        "y_pred": y_pred,
                        "p10": p10,
                        "p50": p50,
                        "p90": p90,
                        "available": True,
                        "model_version": "dfios_forecast v1.0 (sba-adaptive)",
                    })
                return records

        # Fallback trung thực khi hoàn toàn không có dữ liệu: 0.0
        records = []
        for h in range(1, horizon + 1):
            records.append({
                "item_id": item_id,
                "store_id": store_id,
                "h": h,
                "y_pred": 0.0,
                "p10": 0.0,
                "p50": 0.0,
                "p90": 0.0,
                "available": False,
                "model_version": "dfios_forecast v1.0",
            })
        return records


dfios_predictor = DFIOSPredictor()

