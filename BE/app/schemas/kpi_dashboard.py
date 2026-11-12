from datetime import date
from typing import List, Dict, Optional, Any
from pydantic import BaseModel, ConfigDict, Field


class CostCurvePoint(BaseModel):
    date: date
    cycle_index: int
    c3out_holding_cost: float
    c3out_ordering_cost: float
    c3out_stockout_cost: float
    c3out_total_cost: float
    b0_holding_cost: float
    b0_ordering_cost: float
    b0_stockout_cost: float
    b0_total_cost: float
    cost_savings: float


class SegmentAvailability(BaseModel):
    class_id: str
    target: float
    c3out_availability: float
    b0_availability: float
    theta: float
    multiplier: float
    status: str  # "COMPLIANT" | "WARNING"


class KPIDashboardResponse(BaseModel):
    store_id: str
    current_date: date
    days_elapsed: int
    reviews_elapsed: int
    c3out_total_cost: float
    b0_total_cost: float
    total_cost_savings: float
    c3out_overall_availability: float
    b0_overall_availability: float
    segment_availabilities: List[SegmentAvailability]
    cost_curves: List[CostCurvePoint]
    summary_insights: List[str]
