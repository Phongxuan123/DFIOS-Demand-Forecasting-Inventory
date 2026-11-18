from typing import List, Literal, Optional, Dict, Any
from pydantic import BaseModel, Field


class InsightDetail(BaseModel):
    """Machine-readable twin of one ``insights`` sentence: clients render ``code`` + ``params`` in their language."""
    code: str
    params: Dict[str, Any] = Field(default_factory=dict)


class PolicySimulationMetric(BaseModel):
    policy_id: str
    policy_key: Optional[str] = Field(None, description="Stable artifact policy key: B0 | B2 | PCR | P6 (for i18n)")
    policy_name: str  # human label (Vietnamese); clients should localise from policy_key
    description: str
    total_cost: float
    holding_cost: float
    ordering_cost: float
    stockout_cost: float
    availability: float
    total_orders: int
    total_stockouts: Optional[int] = None  # units short are not in the artifact -> null (see stockouts_reason)
    stockouts_reason: Optional[str] = None
    stockouts_reason_code: Optional[str] = None  # e.g. "artifact_no_units"
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
    recommended_policy_key: Optional[str] = None  # B0 | B2 | PCR | P6
    policies: List[PolicySimulationMetric]
    insights: List[str]  # human text (Vietnamese), kept for compatibility
    insight_details: List[InsightDetail] = Field(
        default_factory=list, description="Same insights as stable codes + raw numeric params, in the same order"
    )
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
    what_if: Optional[Dict[str, Any]] = None  # WhatIfResponse as dict when the request carried `what_if`
    what_if_reason: Optional[str] = None
    what_if_endpoint: str = "POST /api/v1/simulation/what-if"
    status: str = "ok"  # "ok" | "artifact_missing"
    reason: Optional[str] = None


class WhatIfPolicy(BaseModel):
    """One (R, s, S) policy of the what-if run: s = ceil(Q_hat_tau * e^(m_g [+ theta_g])), S = s + ceil(kappa_g * EOQ)."""
    policy_key: str = Field(..., min_length=1, max_length=40, description="Client key, e.g. 'current', 'raw_quantile', 'custom'")
    label: Optional[str] = Field(None, max_length=120)
    use_current: bool = Field(
        False, description="Use the store's CURRENT per-class (m_g, kappa_g) of policy_selection (m_g / kappa_g ignored)")
    m_g: Optional[float] = Field(None, ge=-2.0, le=3.0, description="Log-multiplier (required unless use_current)")
    kappa_g: Optional[float] = Field(None, ge=0.0, le=5.0, description="EOQ multiple (required unless use_current); 0 = order up to s")
    use_theta: bool = Field(False, description="Also apply the current C3-OUT theta_g of each class (frozen during the run)")


class WhatIfRequest(BaseModel):
    store_id: str = Field("CA_1", description="Store to simulate")
    lead_time_days: Literal[1, 3, 7] = Field(3, description="L (days)")
    review_period_days: Literal[1, 7] = Field(7, description="R (days): 7 = weekly reviews; 1 = daily reviews (needs daily-origin window quantiles, else 422 with r_options)")
    holding_rate: float = Field(0.002, ge=0.0, le=1.0, description="h: holding cost per unit per day as a share of price")
    stockout_penalty_rate: float = Field(0.35, ge=0.0, le=10.0, description="b: penalty per lost unit as a share of price")
    order_cost: float = Field(2.0, ge=0.0, le=10000.0, description="c: cost per order line")
    tau: Optional[float] = Field(None, ge=0.5, le=0.999, description="Quantile level of Q_hat (default: setting default_service_level)")
    n_reviews: int = Field(21, ge=2, le=52, description="Number of consecutive past reviews to replay (latest ones before the clock)")
    classes: Optional[List[str]] = Field(None, description="Restrict to these ABC-XYZ classes (default: all 9)")
    policies: Optional[List[WhatIfPolicy]] = Field(
        None, max_length=8,
        description="Default: 'current' (stored per-class m_g, kappa_g + current theta) and 'raw_quantile' (m=0, kappa=0, no theta)")


class WhatIfMetrics(BaseModel):
    total_cost: float
    holding_cost: float
    shortage_cost: float
    ordering_cost: float
    orders: int
    availability: Optional[float] = Field(None, description="Observed: share of SKU-periods without a zero-stock day (0..1)")
    availability_pct: Optional[float] = None
    fill_rate: Optional[float] = None
    lost_units: float = 0.0
    demand_units: float = 0.0
    n_items: int = 0
    n_sku_periods: int = 0


class WhatIfClassResult(WhatIfMetrics):
    class_id: str
    m_g: float
    kappa_g: float
    theta_g: float = 0.0
    params_source: Optional[str] = Field(
        None, description="stored (policy_selection) | default_no_stored_selection (m=0, kappa=1) | request")


class WhatIfPolicyResult(BaseModel):
    policy_key: str
    label: Optional[str] = None
    overall: WhatIfMetrics
    by_class: List[WhatIfClassResult]


class WhatIfSkippedClass(BaseModel):
    class_id: str
    reason_code: str  # no_items | too_few_reviews | no_complete_items
    reason: str


class WhatIfResponse(BaseModel):
    source: str = "simulated"
    simulated: bool = True
    store_id: str
    as_of: Optional[str] = Field(None, description="Clock date of the store (origin); every replayed review is before it")
    lead_time_days: int
    review_period_days: int
    horizon_days: int
    tau: float
    holding_rate: float
    stockout_penalty_rate: float
    order_cost: float
    n_reviews: int
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    r_options: List[int] = Field(
        default_factory=list, description="Review periods R (days) replayable for this store and L (window quantiles "
                                          "with H = L + R at every review of the span); also in the 422 detail")
    quantile_basis: str
    initial_stock_basis: str
    policies: List[WhatIfPolicyResult]
    skipped_classes: List[WhatIfSkippedClass] = Field(default_factory=list)
    notes: List[str] = Field(default_factory=list)


class PolicyComparisonRequest(BaseModel):
    store_id: Optional[str] = Field("CA_1", description="Mã cửa hàng/kho mô phỏng")
    horizon_days: Optional[int] = Field(90, ge=14, le=365, description="Số ngày chạy mô phỏng đối đầu")
    target_service_level: Optional[float] = Field(0.96, ge=0.85, le=0.999, description="Mức Availability mục tiêu")
    what_if: Optional[WhatIfRequest] = Field(
        None, description="FR10: when given, a REAL what-if simulation (same as POST /simulation/what-if) fills `what_if`")
