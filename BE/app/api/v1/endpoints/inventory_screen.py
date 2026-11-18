"""G-48 - Inventory Management screen (teacher demo.md screen 3). Read-only, any authenticated role."""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.services.inventory_screen_service import InventoryScreenResponse, inventory_screen_service

router = APIRouter()


@router.get("", response_model=InventoryScreenResponse, summary="G-48 - Inventory Management: SKU table + store summary")
def get_inventory_screen(
    store_id: str = Query(..., description="Store (GLOBAL/ALL rejected)"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    search: Optional[str] = Query(None, description="SKU or product name contains"),
    cls: Optional[str] = Query(None, alias="class", description="A/B/C, X/Y/Z, AX..CZ or NONE"),
    stock_status: Optional[str] = Query(None, alias="status", description="below_s | ok | above_S | no_params"),
    sort_by: Optional[str] = Query(None, description="item_id, name, segment, on_hand, on_order, ip, s, S, days_of_cover, status, stock_value, price"),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Per SKU of the store: on-hand, in transit, IP, s, S, safety stock, EOQ, class, latest recommendation,
    days of cover, stock status (IP < s / ok / IP > S) and cold-start flag; header summary for the whole store."""
    return inventory_screen_service.list_screen(
        db, store_id=store_id, skip=skip, limit=limit, search=search, cls=cls, stock_status=stock_status,
        sort_by=sort_by, sort_dir=sort_dir,
    )
