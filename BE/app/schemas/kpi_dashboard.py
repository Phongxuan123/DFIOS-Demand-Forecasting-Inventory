from datetime import date
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class InsightDetail(BaseModel):
    """Stable code + numbers of one Vietnamese insight sentence (same order as the text list)."""
    code: str
    params: Dict[str, Any] = Field(default_factory=dict)


class CostCurvePoint(BaseModel):
    date: date
    cycle_index: int
    c3out_holding_cost: float
    c3out_ordering_cost: float
    c3out_stockout_cost: float
    c3out_total_cost: float
    b0_holding_cost: Optional[float] = None
    b0_ordering_cost: Optional[float] = None
    b0_stockout_cost: Optional[float] = None
    b0_total_cost: Optional[float] = None
    cost_savings: Optional[float] = None  # b0_total - c3out_total, may be NEGATIVE (never clamped)


class SegmentAvailability(BaseModel):
    class_id: str
    target: float
    c3out_availability: Optional[float] = None  # percent, observed (1 - stocked-out SKU-periods / SKU-periods)
    b0_availability: Optional[float] = None
    n_sku: Optional[int] = None
    n_periods: Optional[int] = None
    theta: float
    multiplier: float
    status: str  # "COMPLIANT" | "WARNING" | "NOT_MEASURED" (no availability measured yet)


class KPIDashboardResponse(BaseModel):
    store_id: str
    current_date: date
    days_elapsed: int
    reviews_elapsed: int
    c3out_total_cost: Optional[float] = None
    b0_total_cost: Optional[float] = None
    total_cost_savings: Optional[float] = None
    c3out_overall_availability: Optional[float] = None
    b0_overall_availability: Optional[float] = None
    # demo.md §6.2 / FR9: fill rate = units sold / units demanded (sold + lost) over the simulated days, percent
    c3out_fill_rate: Optional[float] = None
    b0_fill_rate: Optional[float] = None
    # demo.md §6.2: number of classes below the commitment over the last ``recent_cycles`` closed cycles
    classes_below_recent: Optional[int] = None
    classes_measured_recent: Optional[int] = None
    recent_cycles: int = 4
    recent_cycles_used: int = 0
    # demo.md §6.2 Reports: orders placed over the simulated period (DFIOS approved/completed lines, B0 shadow orders)
    c3out_orders_count: Optional[int] = None
    b0_orders_count: Optional[int] = None
    start_date: Optional[date] = None
    segment_availabilities: List[SegmentAvailability]
    cost_curves: List[CostCurvePoint]
    summary_insights: List[str]
    # --- provenance (additive): every unavailable metric is null + a reason ---
    source: str = "simulator"
    as_of: Optional[date] = None
    n_skus: Optional[int] = None
    target_availability: Optional[float] = None  # percent, from system setting default_service_level
    cost_basis: str = "A3: h=0.002*price/day on end-of-day stock, b=0.35*price/lost unit, c=2/placed order"
    b0_definition: str = ("B0-MA-OUT-0.95 = S = ceil(mean56*(L+R) + z0.95*sd56*sqrt(L+R)) from the 56 days of sales before the "
                          "review, order S - IP when IP < S, no controller; simulated in parallel on the same demand and initial stock")
    cost_reason: Optional[str] = None
    availability_reason: Optional[str] = None
    b0_reason: Optional[str] = None
    # --- round 5: stable codes next to the Vietnamese texts (client-side i18n) ---
    cost_reason_code: Optional[str] = None  # no_clock | no_simulated_days
    availability_reason_code: Optional[str] = None  # no_clock | no_closed_cycle
    b0_reason_code: Optional[str] = None  # no_clock | no_closed_cycle | no_shadow | no_shadow_cost
    insight_details: List[InsightDetail] = Field(
        default_factory=list, description="Same order as summary_insights: {code, params}")
