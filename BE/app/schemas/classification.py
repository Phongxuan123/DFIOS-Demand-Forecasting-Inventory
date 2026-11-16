from datetime import datetime
from typing import Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator


# --- UC25: Thresholds ---

class ClassificationThresholds(BaseModel):
    a_cutoff: float = Field(80.0, description="Ngưỡng tích lũy doanh thu nhóm A (%, mặc định 80.0)")
    b_cutoff: float = Field(95.0, description="Ngưỡng tích lũy doanh thu nhóm B (%, mặc định 95.0, tức thêm 15%)")
    c_cutoff: float = Field(100.0, description="Ngưỡng tích lũy doanh thu nhóm C (%, mặc định 100.0)")
    cv_x: float = Field(0.5, description="Ngưỡng hệ số biến động nhóm X (CV <= cv_x, mặc định 0.5)")
    cv_y: float = Field(1.0, description="Ngưỡng hệ số biến động nhóm Y (cv_x < CV <= cv_y, mặc định 1.0)")


class ClassificationThresholdsUpdate(BaseModel):
    a_cutoff: float = Field(..., gt=0, lt=100, description="Ngưỡng tích lũy doanh thu nhóm A (%)")
    b_cutoff: float = Field(..., gt=0, lt=100, description="Ngưỡng tích lũy doanh thu nhóm B (%)")
    cv_x: float = Field(..., gt=0, description="Ngưỡng hệ số biến động nhóm X")
    cv_y: float = Field(..., gt=0, description="Ngưỡng hệ số biến động nhóm Y")

    @model_validator(mode="after")
    def validate_cutoffs(self) -> "ClassificationThresholdsUpdate":
        if self.a_cutoff >= self.b_cutoff:
            raise ValueError(f"Ngưỡng a_cutoff ({self.a_cutoff}) phải nhỏ hơn b_cutoff ({self.b_cutoff}).")
        if self.cv_x >= self.cv_y:
            raise ValueError(f"Ngưỡng cv_x ({self.cv_x}) phải nhỏ hơn cv_y ({self.cv_y}).")
        return self


# --- UC26: Matrix 3x3 ---

class SegmentSummary(BaseModel):
    segment: str  # "AX", "AY", "AZ", ...
    abc: str      # "A", "B", "C"
    xyz: str      # "X", "Y", "Z"
    sku_count: int
    sku_percentage: float
    revenue: float
    revenue_percentage: float


class ClassificationMatrixResponse(BaseModel):
    total_skus: int
    total_revenue: float
    segments: List[SegmentSummary]
    matrix: Dict[str, SegmentSummary]
    thresholds: ClassificationThresholds
    last_updated: Optional[datetime] = None
    # P-10: kho của ma trận và số SKU theo nguồn lớp ("ground_truth" = C3-OUT A5, "thresholds" = ngưỡng UC25)
    store_id: Optional[str] = None
    class_sources: Dict[str, int] = Field(default_factory=dict)


# --- UC27: Filter SKUs ---

class SKUClassificationItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    item_id: str
    store_id: Optional[str] = None
    class_source: Optional[str] = None
    threshold_segment: Optional[str] = None
    product_name: Optional[str] = None
    category: Optional[str] = None
    abc: str
    xyz: str
    segment: str
    revenue: float
    revenue_share: float
    cumulative_share: float
    mean_demand: float
    std_demand: float
    cv: float
    updated_at: datetime


class SKUClassificationListResponse(BaseModel):
    items: List[SKUClassificationItem]
    total: int
    skip: int
    limit: int


# --- UC28: Recommendations ---

class RecommendationResponse(BaseModel):
    segment: str
    description: str
    strategy: str
    review_frequency: str
    replenishment_policy: str
    safety_stock_level: str
    priority: str
    # round 5: stable codes of the Vietnamese texts above (client-side i18n)
    description_code: Optional[str] = None
    strategy_code: Optional[str] = None
    replenishment_policy_code: Optional[str] = None
    review_frequency_code: Optional[str] = None  # daily | weekly | weekly_or_event | biweekly | monthly | quarterly_or_on_demand
    safety_stock_level_code: Optional[str] = None  # low | medium | high | standard | cautious | moderate | none_or_minimal
    priority_code: Optional[str] = None  # critical | high | medium | medium_low | low | very_low


class ClassificationRecomputeResponse(BaseModel):
    success: bool
    message: str
    total_skus_classified: int
    thresholds: ClassificationThresholds
    recomputed_at: datetime
    store_id: Optional[str] = None
    source: str = "auto"
    class_sources: Dict[str, int] = Field(default_factory=dict)
