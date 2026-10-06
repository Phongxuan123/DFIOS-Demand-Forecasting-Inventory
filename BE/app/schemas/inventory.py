from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


class InventoryUpdate(BaseModel):
    on_hand: Optional[float] = Field(None, ge=0, description="Số lượng tồn kho thực tế sau kiểm kê (On-hand >= 0)")
    on_order: Optional[float] = Field(None, ge=0, description="Số lượng hàng đang về (On-order >= 0)")
    reason: Optional[str] = Field(None, description="Lý do điều chỉnh số liệu tồn kho (ví dụ: 'Kiểm kê định kỳ', 'Thất thoát')")


class InventoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    item_id: str
    store_id: str
    on_hand: float
    on_order: float
    updated_at: Optional[datetime] = None
    product_name: Optional[str] = None


class InventoryListResponse(BaseModel):
    items: List[InventoryResponse]
    total: int
    skip: int
    limit: int


class InventoryAdjustmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    item_id: str
    store_id: str
    old_on_hand: float
    new_on_hand: float
    old_on_order: float
    new_on_order: float
    reason: Optional[str] = None
    adjusted_by: Optional[str] = None
    created_at: datetime


class InventoryAdjustmentListResponse(BaseModel):
    items: List[InventoryAdjustmentResponse]
    total: int
    skip: int
    limit: int
