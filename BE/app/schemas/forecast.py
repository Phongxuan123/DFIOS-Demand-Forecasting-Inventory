import datetime as dt
from datetime import date, datetime
from typing import Any, Dict, List, Optional
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
    backtest: bool = Field(False, description="True: forecast_date <= simulated clock date of the store (retrospective forecast, actuals may exist)")
    source: str = Field("forecast_table", description="production_artifact | backtest | forecast_table")


class ForecastListResponse(BaseModel):
    items: List[ForecastItemResponse]
    total: int
    horizon: int
    model_version: Optional[str] = None
    model_name: Optional[str] = Field(None, description="Filter applied (substring of model_version) when given")
    store_id: Optional[str] = None
    source: Optional[str] = None
    backtest: bool = False
    available_versions: List[str] = Field(default_factory=list, description="All model versions available for the filter (exactly ONE is returned)")
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
    # additive (U-04): the series never goes beyond the simulated clock date
    as_of: Optional[str] = None
    bounded_by_clock: bool = False


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
    mase: Optional[float] = Field(None, description="MAE / naive one-step MAE of the training history before the first compared day; null when < 2 training days")
    mase_scale_n: int = Field(0, description="Days of training history used for the MASE scale")
    total_actual: float
    total_predicted: float
    data_points: int


class ForecastCompareResponse(BaseModel):
    item_id: str
    store_id: Optional[str] = None
    model_version: Optional[str] = None
    model_version_source: Optional[str] = Field(None, description="requested | resolved_ensemble | resolved_other | none")
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
    # B-06: REAL forecast errors r = actual - prediction (None when no actual overlaps the horizon)
    error_distribution: Optional[ErrorDistribution] = None
    error_distribution_n: int = 0
    # width of the p10-p90 band (uncertainty), kept separate from the error distribution
    band_width_distribution: Optional[ErrorDistribution] = None


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
    base_value: Optional[float] = None
    features: List[SHAPFeatureContribution]
    # additive (U-03): False => no attribution exists for this SKU, features is empty, never fabricated
    available: bool = True
    source: Optional[str] = None  # stored_explanations | none
    reason: Optional[str] = None
    # stable machine code for the FE to translate (e.g. "no_stored_shap"); reason stays as raw English text
    reason_code: Optional[str] = None


# --- UC24: Manual Forecast Override ---

class ForecastOverrideCreate(BaseModel):
    forecast_date: date = Field(..., description="Ngày dự báo cần điều chỉnh")
    override_value: float = Field(..., ge=0, le=100000.0, description="Giá trị dự báo mới (0 <= v <= 100000)")
    reason: str = Field(..., min_length=1, max_length=500, description="Lý do điều chỉnh (bắt buộc)")
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


# --- Bulk Override ---

class BulkOverrideItem(BaseModel):
    store_id: str = Field("CA_1", description="Mã cửa hàng / kho")
    item_id: str = Field(..., description="Mã SKU")
    date: dt.date = Field(..., description="Ngày dự báo cần điều chỉnh")
    h: Optional[int] = Field(None, ge=1, le=28, description="Bước dự báo h (1..28)")
    value: float = Field(..., ge=0, le=100000.0, description="Giá trị điều chỉnh (0 <= v <= 100000)")
    reason: str = Field(..., min_length=1, max_length=500, description="Lý do điều chỉnh")


class BulkOverrideRequest(BaseModel):
    items: List[BulkOverrideItem] = Field(..., min_length=1, max_length=1000, description="Danh sách bản ghi điều chỉnh hàng loạt (tối đa 1000)")


class BulkOverrideResponse(BaseModel):
    success: bool
    created_count: int
    skipped_count: int
    errors: List[Dict[str, Any]] = []
    message: Optional[str] = None
