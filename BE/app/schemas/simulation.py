from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


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
    total_stockouts: Optional[int] = None  # units short are not in the artifact -> null (see stockouts_reason)
    stockouts_reason: Optional[str] = None
    is_feasible: bool
    cost_increase_vs_best: float = 0.0
    # --- provenance / real artifact values (additive) ---
    tau: Optional[float] = None
    csl: Optional[float] = None  # observed availability (0..1) of the artifact row
    fill_rate: Optional[float] = None
    artifact_row: Optional[str] = None  # exact row of c3ok_results.csv
    artifact_total_cost: Optional[float] = None  # unscaled cost_BIKIP of the artifact (25,950 SKUs x 357 days)


class PolicyComparisonResponse(BaseModel):
    store_id: str
    simulation_horizon_days: int
    sku_count: int
    recommended_policy: Optional[str] = None
    policies: List[PolicySimulationMetric]
    insights: List[str]
    # --- provenance (additive) ---
    source: str = "artifact_extract"  # "artifact_extract" = values read from c3ok_results.csv, NOT simulated
    simulated: bool = False
    as_of: Optional[str] = None
    n_skus: Optional[int] = None  # SKUs of the requested store
    artifact_n_skus: Optional[int] = None
    artifact_n_days: Optional[int] = None
    scale_factor: Optional[float] = None
    scale_basis: Optional[str] = None
    price_source: Optional[str] = None
    avg_price: Optional[float] = None
    cost_basis: str = "A3: h=0.002*price/day, b=0.35*price/unit, c=2/order (cost_BIKIP)"
    what_if: Optional[Dict[str, Any]] = None
    what_if_reason: Optional[str] = None
    status: str = "ok"  # "ok" | "artifact_missing"
    reason: Optional[str] = None


class PolicyComparisonRequest(BaseModel):
    store_id: Optional[str] = Field("CA_1", description="Mã cửa hàng/kho mô phỏng")
    horizon_days: Optional[int] = Field(90, ge=14, le=365, description="Số ngày chạy mô phỏng đối đầu")
    target_service_level: Optional[float] = Field(0.96, ge=0.85, le=0.999, description="Mức Availability mục tiêu")
