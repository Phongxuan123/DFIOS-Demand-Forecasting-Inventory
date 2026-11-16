from datetime import datetime, date
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


# --- UC33: View Replenishment Recommendation List ---

class ReplenishmentItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    item_id: str
    store_id: str
    product_name: Optional[str] = None
    category: Optional[str] = None
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = None
    on_hand: float = Field(0.0, description="CURRENT on hand (live inventory row, clock date), not the review-date value")
    on_order: float = Field(0.0, description="CURRENT on order (live inventory row, clock date), not the review-date value")
    rop: float = 0.0
    safety_stock: float = 0.0
    order_up_to_S: Optional[float] = None
    reorder_point_s: Optional[float] = None
    inventory_position: Optional[float] = Field(
        None, description="IP at review_date (= on_hand_at_review + on_order_at_review), basis of q = S - IP"
    )
    on_hand_at_review: Optional[float] = Field(None, description="On hand at review_date (null for legacy rows)")
    on_order_at_review: Optional[float] = Field(None, description="On order at review_date (null for legacy rows)")
    eoq_quantity: Optional[float] = None
    policy_applied: Optional[str] = None
    review_date: Optional[date] = None
    recommended_qty: float
    final_qty: float
    priority: str = Field(..., description="Mức độ ưu tiên: CRITICAL, HIGH, MEDIUM, LOW")
    status: str = Field(..., description="Trạng thái: PENDING, APPROVED, REJECTED, CANCELLED")
    reason: Optional[str] = None
    reason_code: Optional[str] = Field(
        None,
        description="Stable code of `reason`: ip_below_s (system proposal, params ip/s/S/q/policy) | user_adjusted | "
                    "user_rejected | cancelled (the text is the user's own note)",
    )
    reason_params: Dict[str, Any] = Field(default_factory=dict)
    decided_by: Optional[str] = None
    created_at: datetime
    decided_at: Optional[datetime] = None
    # --- policy context (additive; null when the SKU has no classification / forecast / parameter row) ---
    abc_xyz_class: Optional[str] = None
    theta: Optional[float] = Field(None, description="theta_g of the class of the SKU (latest calibration state)")
    m_g: Optional[float] = None
    kappa_g: Optional[float] = None
    q_hat: Optional[float] = Field(None, description="Q_hat(tau) of the latest stored window quantile at the service level of the SKU")
    lead_time_days: Optional[int] = None


class ReplenishmentListResponse(BaseModel):
    items: List[ReplenishmentItemResponse]
    total: int
    skip: int
    limit: int
    pending_count: int
    approved_count: int


# --- UC34: Adjust Recommended Order Quantity ---

class ReplenishmentAdjustRequest(BaseModel):
    final_qty: float = Field(..., gt=0, description="Số lượng đặt hàng điều chỉnh (phải > 0)")
    reason: str = Field(..., min_length=3, description="Lý do điều chỉnh số lượng (bắt buộc)")


# --- UC35, UC36: Approve / Reject / Cancel Action ---

class ReplenishmentActionRequest(BaseModel):
    reason: Optional[str] = Field(None, description="Lý do xử lý (bắt buộc khi REJECT hoặc CANCEL)")


# --- Generate Recommendations Response ---

class ReplenishmentGenerateResponse(BaseModel):
    success: bool
    generated_count: int
    message: str
