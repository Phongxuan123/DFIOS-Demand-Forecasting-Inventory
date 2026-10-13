from datetime import date, datetime
from typing import Dict, List, Optional
from pydantic import BaseModel, Field, ConfigDict

SUPPORTED_MODELS = ["lightgbm", "xgboost", "baseline_naive"]
ROADMAP_MODELS = ["arima", "lstm", "tft"]


class TrainJobRequest(BaseModel):
    models: List[str] = Field(
        default=["lightgbm", "xgboost", "baseline_naive"],
        description="Danh sách mô hình cần huấn luyện & benchmark (lightgbm, xgboost, baseline_naive)",
    )
    item_ids: Optional[List[str]] = Field(None, description="Danh sách SKU cần huấn luyện (None = tất cả)")
    store_id: Optional[str] = Field(None, description="Mã cửa hàng/kho cần huấn luyện")
    start_date: Optional[date] = Field(None, description="Ngày bắt đầu khoảng thời gian huấn luyện")
    end_date: Optional[date] = Field(None, description="Ngày kết thúc khoảng thời gian huấn luyện")
    horizon: int = Field(default=28, ge=1, le=90, description="Số ngày dự báo để đánh giá sai số (mặc định 28 ngày)")


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
