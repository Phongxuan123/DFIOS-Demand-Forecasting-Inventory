from datetime import date, datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, ConfigDict, model_validator

# R-03: honest names. "gbdt_lags" / "gbdt_trend" are two presets of the SAME built-in pure-numpy GBDT
# (no LightGBM / XGBoost library is used). "lightgbm" / "xgboost" are kept only as legacy aliases.
SUPPORTED_MODELS = ["lightgbm", "xgboost", "baseline_naive", "gbdt_lags", "gbdt_trend"]
MODEL_ALIASES = {"lightgbm": "gbdt_lags", "xgboost": "gbdt_trend"}
MODEL_IMPLEMENTATION = {
    "gbdt_lags": "TinyGBDT (pure numpy) preset A: lags 1/7/14, mean7, dow, event; depth 4, lr 0.10, l2 0.5",
    "gbdt_trend": "TinyGBDT (pure numpy) preset B: lags 1/7, diff7, mean7, trend, dow, event; depth 3, lr 0.08, l2 1.5",
    "baseline_naive": "Seasonal naive (lag 7)",
}
ROADMAP_MODELS = ["arima", "lstm", "tft"]


class TrainJobRequest(BaseModel):
    models: List[str] = Field(
        default=["gbdt_lags", "gbdt_trend", "baseline_naive"],
        description="Mô hình cần benchmark: gbdt_lags, gbdt_trend, baseline_naive. 'lightgbm'/'xgboost' là alias cũ của gbdt_lags/gbdt_trend (cùng một GBDT numpy tự cài, KHÔNG dùng thư viện LightGBM/XGBoost)",
    )
    item_ids: Optional[List[str]] = Field(None, description="Danh sách SKU cần huấn luyện (None = tất cả)")
    store_id: Optional[str] = Field(None, description="Mã cửa hàng/kho cần huấn luyện")
    start_date: Optional[date] = Field(None, description="Ngày bắt đầu khoảng thời gian huấn luyện")
    end_date: Optional[date] = Field(None, description="Ngày kết thúc khoảng thời gian huấn luyện")
    horizon: int = Field(default=28, ge=1, le=28, description="Số ngày dự báo để đánh giá sai số (tối đa 28 ngày)")

    # Trường tương thích FE và điều khiển đăng ký model candidate
    algorithm: Optional[str] = Field(None, description="Tên thuật toán đơn lẻ (tương thích FE)")
    sku_list: Optional[List[str]] = Field(None, description="Danh sách SKU (tương thích FE)")
    test_days: Optional[int] = Field(None, description="Số ngày test (tương thích FE)")
    hyperparameters: Optional[dict] = Field(None, description="Siêu tham số mô hình")
    register_candidate: bool = Field(default=False, description="Chỉ tự động đăng ký candidate vào ModelRegistry khi bật True")

    @model_validator(mode="before")
    @classmethod
    def reconcile_compat_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "algorithm" in data and data["algorithm"] and ("models" not in data or not data["models"]):
                data["models"] = [data["algorithm"]]
            if "sku_list" in data and data["sku_list"] and ("item_ids" not in data or not data["item_ids"]):
                data["item_ids"] = data["sku_list"]
            if "test_days" in data and data["test_days"] and ("horizon" not in data or not data["horizon"]):
                data["horizon"] = data["test_days"]
        return data


class ModelBenchmarkMetrics(BaseModel):
    mae: float = Field(..., description="Mean Absolute Error")
    rmse: float = Field(..., description="Root Mean Squared Error")
    mase: float = Field(..., description="Mean Absolute Scaled Error")
    wrmsse: float = Field(..., description="Weighted Root Mean Squared Scaled Error (M5 benchmark)")


class TrainJobCreateResponse(BaseModel):
    job_id: str
    status: str
    message: str
    created_at: datetime


class TrainJobResponse(BaseModel):
    id: str
    status: str = Field(..., description="Trạng thái: pending, running, done, failed")
    triggered_by: Optional[str] = None
    parameters: dict
    metrics: Optional[Dict[str, ModelBenchmarkMetrics]] = None
    best_model: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class TrainJobListResponse(BaseModel):
    items: List[TrainJobResponse]
    total: int
