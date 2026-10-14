from datetime import datetime
from typing import Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


# --- UC29: Target Service Level Configuration ---

class ServiceLevelConfig(BaseModel):
    default_service_level: float = Field(0.95, ge=0.85, le=0.99, description="Mức phục vụ mục tiêu chung (0.85 - 0.99)")
    category_service_levels: Dict[str, float] = Field(default_factory=dict, description="Mức phục vụ riêng theo nhóm hàng (ví dụ: FOODS=0.95)")
    item_service_levels: Dict[str, float] = Field(default_factory=dict, description="Mức phục vụ riêng cho từng SKU cụ thể")


class ServiceLevelConfigUpdate(BaseModel):
    default_service_level: Optional[float] = Field(None, ge=0.85, le=0.99, description="Mức phục vụ mục tiêu chung")
    category_service_levels: Optional[Dict[str, float]] = Field(None, description="Mức phục vụ theo nhóm hàng")
    item_service_levels: Optional[Dict[str, float]] = Field(None, description="Mức phục vụ theo SKU")


# --- UC30: Inventory Optimization Parameters (SS, ROP, EOQ) ---

class InventoryParamItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    item_id: str
    store_id: str
    product_name: Optional[str] = None
    category: Optional[str] = None
    service_level: float
    lead_time_days: int
    safety_stock: float
    reorder_point: float
    eoq: float
    annual_demand: float
    holding_cost: float
    order_cost: float
    unit_price: float
    source: str  # "ml" | "static"
    updated_at: Optional[datetime] = None


class InventoryParamsListResponse(BaseModel):
    items: List[InventoryParamItem]
    total: int
    skip: int
    limit: int


class RecomputeRequest(BaseModel):
    store_id: Optional[str] = Field("CA_1", description="Mã cửa hàng/kho cần tính toán lại")
    item_id: Optional[str] = Field(None, description="Mã SKU (để trống nếu tính lại toàn bộ)")
    force_static: bool = Field(False, description="Nếu True, ép buộc dùng công thức tĩnh Moving Average bỏ qua ML")


class RecomputeResponse(BaseModel):
    success: bool
    computed_count: int
    message: str


# --- UC31: Compare ML vs Static Formula ---

class CompareParamItem(BaseModel):
    item_id: str
    product_name: Optional[str] = None
    store_id: str
    category: Optional[str] = None
    lead_time_days: int
    service_level: float
    
    # ML Parameters
    ml_safety_stock: float
    ml_reorder_point: float
    ml_eoq: float
    ml_annual_holding_cost: float

    # Static Parameters
    static_safety_stock: float
    static_reorder_point: float
    static_eoq: float
    static_annual_holding_cost: float

    # Differences & Savings
    ss_difference: float  # static_safety_stock - ml_safety_stock
    rop_difference: float
    eoq_difference: float
    holding_cost_savings: float  # static_holding_cost - ml_holding_cost


class CompareStaticResponse(BaseModel):
    items: List[CompareParamItem]
    total_items: int
    total_holding_cost_savings: float
    avg_ss_reduction_percent: float


# --- UC32: Cost Sensitivity Analysis ---

class SensitivityScenario(BaseModel):
    scenario_id: str
    lead_time_delta_percent: float
    lead_time_days: int
    service_level_delta_percent: float
    service_level: float
    safety_stock: float
    reorder_point: float
    eoq: float
    holding_cost: float
    ordering_cost: float
    stockout_cost: float
    total_cost: float
    cost_difference_vs_baseline: float


class SensitivityAnalysisRequest(BaseModel):
    item_id: Optional[str] = Field(None, description="SKU cần chạy phân tích độ nhạy (nếu None thì lấy SKU đại diện hoặc trung bình)")
    store_id: Optional[str] = Field("CA_1", description="Mã cửa hàng/kho")
    lead_time_deltas: List[float] = Field(
        default=[-0.20, -0.10, 0.0, 0.10, 0.20],
        description="Danh sách độ lệch Lead Time mô phỏng (ví dụ ±20%)",
    )
    service_level_deltas: List[float] = Field(
        default=[-0.05, -0.02, 0.0, 0.02, 0.05],
        description="Danh sách độ lệch Service Level mô phỏng (ví dụ ±5%)",
    )
    holding_cost_rate: float = Field(0.20, gt=0, description="Tỷ lệ chi phí lưu kho hàng năm so với đơn giá")
    stockout_cost_per_unit: float = Field(5.0, gt=0, description="Chi phí phạt ước tính khi hết hàng trên mỗi đơn vị thiếu hụt")
    order_cost: float = Field(50.0, gt=0, description="Chi phí mỗi lần đặt hàng (S)")


class SensitivityAnalysisResponse(BaseModel):
    item_id: Optional[str] = None
    store_id: str
    baseline_scenario: SensitivityScenario
    scenarios: List[SensitivityScenario]
    insights: List[str]
