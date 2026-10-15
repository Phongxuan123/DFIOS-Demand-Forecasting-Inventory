from datetime import datetime
from typing import List, Optional
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
    on_hand: float = 0.0
    on_order: float = 0.0
    rop: float = 0.0
    safety_stock: float = 0.0
    recommended_qty: float
    final_qty: float
    priority: str = Field(..., description="Mức độ ưu tiên: CRITICAL, HIGH, MEDIUM, LOW")
    status: str = Field(..., description="Trạng thái: PENDING, APPROVED, REJECTED, CANCELLED")
    reason: Optional[str] = None
    decided_by: Optional[str] = None
    created_at: datetime
    decided_at: Optional[datetime] = None


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
