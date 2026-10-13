from datetime import date, datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


# --- UC17, UC18, UC19: Forecast Views & Filters ---

class ForecastItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    item_id: str
    store_id: str
    forecast_date: date
    h: int
    y_pred: float
    original_value: Optional[float] = None
    is_overridden: bool = False
    override_reason: Optional[str] = None
    p10: Optional[float] = None
    p50: Optional[float] = None
    p90: Optional[float] = None
    product_name: Optional[str] = None
    category: Optional[str] = None
    model_version: str
    generated_at: Optional[datetime] = None


class ForecastListResponse(BaseModel):
    items: List[ForecastItemResponse]
    total: int
    horizon: int
    model_version: Optional[str] = None
    skip: int
    limit: int


# --- UC20: Historical Demand ---

class HistoryPoint(BaseModel):
    date: str
    quantity: float


class HistoricalDemandResponse(BaseModel):
    item_id: str
    store_id: Optional[str] = None
    granularity: str
    total_quantity: float
    avg_quantity: float
    min_quantity: float
    max_quantity: float
    count: int
    history: List[HistoryPoint]


# --- UC21: Compare Actual vs Predicted ---

class ComparePoint(BaseModel):
    date: date
    actual: float
    predicted: float
    error: float
    abs_error: float
    percentage_error: Optional[float] = None
    p10: Optional[float] = None
    p50: Optional[float] = None
    p90: Optional[float] = None


class CompareMetrics(BaseModel):
    mae: float
    rmse: float
    mape: Optional[float] = None
    total_actual: float
    total_predicted: float
    data_points: int


class ForecastCompareResponse(BaseModel):
    item_id: str
    store_id: Optional[str] = None
    metrics: CompareMetrics
    comparison: List[ComparePoint]


# --- UC22: Prediction Uncertainty Band ---

class UncertaintyPoint(BaseModel):
    forecast_date: date
    h: int
    y_pred: float
    p10: Optional[float] = None
    p50: Optional[float] = None
    p90: Optional[float] = None
    uncertainty_range: Optional[float] = None


class ErrorDistribution(BaseModel):
    mean: float
    std: float
    min: float
    max: float
    p10: float
    p25: float
    p50: float
    p75: float
    p90: float


class ForecastUncertaintyResponse(BaseModel):
    item_id: str
    store_id: Optional[str] = None
    horizon: int
    sigma_h: Optional[float] = None
    points: List[UncertaintyPoint]
    error_distribution: Optional[ErrorDistribution] = None


# --- UC23: Forecast Explanation (SHAP) ---

class SHAPFeatureContribution(BaseModel):
    feature_name: str
    importance_score: float
    direction: Optional[str] = None
    description: Optional[str] = None


class ForecastExplanationResponse(BaseModel):
    item_id: str
    store_id: Optional[str] = None
    model_name: str
    model_version: str
    base_value: float
    features: List[SHAPFeatureContribution]


# --- UC24: Manual Forecast Override ---

class ForecastOverrideCreate(BaseModel):
    forecast_date: date = Field(..., description="Ngày dự báo cần điều chỉnh")
    override_value: float = Field(..., ge=0, description="Giá trị dự báo mới (>= 0)")
    reason: str = Field(..., min_length=1, description="Lý do điều chỉnh (bắt buộc)")
    store_id: Optional[str] = Field("CA_1", description="Mã cửa hàng / kho")
    h: Optional[int] = Field(None, ge=1, le=28, description="Bước dự báo h (1..28)")


class ForecastOverrideResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    item_id: str
    store_id: str
    forecast_date: date
    h: Optional[int] = None
    original_value: float
    override_value: float
    reason: str
    created_by: str
    created_at: datetime
    is_active: bool


class ForecastOverrideRevertResponse(BaseModel):
    success: bool
    message: str
    id: str
    item_id: str
    original_value: float
