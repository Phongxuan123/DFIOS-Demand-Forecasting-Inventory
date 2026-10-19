from datetime import datetime, timezone
from enum import Enum
import json
from typing import Any, Dict, Optional
from pydantic import BaseModel, Field


class EventType(str, Enum):
    """
    Danh sách định danh các loại sự kiện trong hệ thống.
    Muốn thêm loại sự kiện mới chỉ cần khai báo thêm 1 dòng tại đây.
    """
    INVENTORY_UPDATED = "inventory.updated"
    ALERT_CREATED = "alert.created"
    STOCK_ALERT = "stock.alert"


class InventoryUpdatedData(BaseModel):
    """
    Dữ liệu payload cho sự kiện inventory.updated.
    CHỈ chứa tín hiệu sự kiện (mã SKU và người thao tác),
    tuyệt đối KHÔNG chứa số lượng tồn kho thực tế hay dữ liệu nhạy cảm.
    """
    type: str = EventType.INVENTORY_UPDATED.value
    sku_id: str
    at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    actor_id: str


class StockAlertData(BaseModel):
    """
    Dữ liệu payload cho sự kiện stock.alert (UC10).
    """
    type: str = EventType.STOCK_ALERT.value
    item_id: str
    store_id: str
    severity: str
    on_hand: float
    reorder_point: float
    safety_stock: float
    message: str
    at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class SystemEvent(BaseModel):
    """
    Model sự kiện hệ thống chuẩn hóa theo định dạng SSE (Server-Sent Events).
    """
    id: Optional[int] = None
    event: str
    data: Dict[str, Any]

    def to_sse_message(self) -> str:
        """
        Định dạng sự kiện theo đúng chuẩn contract SSE:
        id: <int>
        event: <loại sự kiện>
        data: <chuỗi json>
        """
        id_str = f"id: {self.id}\n" if self.id is not None else ""
        data_str = json.dumps(self.data, separators=(",", ":"))
        return f"{id_str}event: {self.event}\ndata: {data_str}\n\n"


def create_inventory_updated_event(sku_id: str, actor_id: str, event_id: Optional[int] = None) -> SystemEvent:
    """
    Hàm tiện ích khởi tạo sự kiện inventory.updated có đầy đủ kiểu dữ liệu.
    """
    payload = InventoryUpdatedData(sku_id=sku_id, actor_id=actor_id)
    return SystemEvent(
        id=event_id,
        event=EventType.INVENTORY_UPDATED.value,
        data=payload.model_dump(),
    )


def create_stock_alert_event(
    item_id: str,
    store_id: str,
    severity: str,
    on_hand: float,
    reorder_point: float,
    safety_stock: float,
    message: str,
    event_id: Optional[int] = None,
) -> SystemEvent:
    """
    Hàm tiện ích khởi tạo sự kiện stock.alert cho UC10.
    """
    payload = StockAlertData(
        item_id=item_id,
        store_id=store_id,
        severity=severity,
        on_hand=on_hand,
        reorder_point=reorder_point,
        safety_stock=safety_stock,
        message=message,
    )
    return SystemEvent(
        id=event_id,
        event=EventType.STOCK_ALERT.value,
        data=payload.model_dump(),
    )


