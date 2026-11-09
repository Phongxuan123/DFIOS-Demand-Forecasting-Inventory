from typing import List, Optional, Dict, Any
from pydantic import BaseModel, ConfigDict, Field


class PolicySimulationMetric(BaseModel):
    policy_id: str
    policy_name: str
    description: str
    total_cost: float
    holding_cost: float
    ordering_cost: float
    stockout_cost: float
    availability: float
    total_orders: int
    total_stockouts: int
    is_feasible: bool
    cost_increase_vs_best: float = 0.0


class PolicyComparisonResponse(BaseModel):
    store_id: str
    simulation_horizon_days: int
    sku_count: int
    recommended_policy: str
    policies: List[PolicySimulationMetric]
    insights: List[str]


class PolicyComparisonRequest(BaseModel):
    store_id: Optional[str] = Field("CA_1", description="Mã cửa hàng/kho mô phỏng")
    horizon_days: Optional[int] = Field(90, ge=14, le=365, description="Số ngày chạy mô phỏng đối đầu")
    target_service_level: Optional[float] = Field(0.96, ge=0.85, le=0.999, description="Mức Availability mục tiêu")
