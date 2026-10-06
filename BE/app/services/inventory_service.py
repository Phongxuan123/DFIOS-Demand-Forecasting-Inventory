import asyncio
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session

from app.models.inventory import Inventory
from app.models.inventory_adjustment import InventoryAdjustment
from app.schemas.inventory import (
    InventoryUpdate,
    InventoryResponse,
    InventoryListResponse,
    InventoryAdjustmentResponse,
    InventoryAdjustmentListResponse,
)
from app.repositories.inventory_repository import inventory_repository
from app.repositories.product_repository import product_repository
from app.services.audit_service import audit_service
from app.core.events import event_bus
from app.schemas.event import create_inventory_updated_event


class InventoryService:
    """
    Dịch vụ quản lý tồn kho On-hand/On-order (UC13) và lịch sử kiểm kê (UC14).
    Tích hợp Realtime SSE khi có thay đổi số liệu tồn kho.
    """

    def list_inventory(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 50,
        store_id: Optional[str] = None,
        item_id: Optional[str] = None,
        search: Optional[str] = None,
    ) -> InventoryListResponse:
        records, total = inventory_repository.list_inventory(
            db, skip=skip, limit=limit, store_id=store_id, item_id=item_id, search=search
        )
        items = []
        for inv, prod_name in records:
            resp = InventoryResponse(
                item_id=inv.item_id,
                store_id=inv.store_id,
                on_hand=inv.on_hand,
                on_order=inv.on_order,
                updated_at=inv.updated_at,
                product_name=prod_name,
            )
            items.append(resp)

        return InventoryListResponse(
            items=items,
            total=total,
            skip=skip,
            limit=limit,
        )

    def get_inventory(self, db: Session, item_id: str, store_id: str) -> InventoryResponse:
        inv = inventory_repository.get(db, item_id, store_id)
        if not inv:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy bản ghi tồn kho cho SKU '{item_id}' tại kho/cửa hàng '{store_id}'",
            )
        prod = product_repository.get_by_item_id(db, item_id)
        return InventoryResponse(
            item_id=inv.item_id,
            store_id=inv.store_id,
            on_hand=inv.on_hand,
            on_order=inv.on_order,
            updated_at=inv.updated_at,
            product_name=prod.name if prod else None,
        )

    def update_inventory(
        self,
        db: Session,
        item_id: str,
        store_id: str,
        request: InventoryUpdate,
        background_tasks: Optional[BackgroundTasks] = None,
        user_email: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> InventoryResponse:
        """
        UC13: Cập nhật tồn kho On-hand / On-order và phát sự kiện Realtime SSE.
        UC14: Tự động lưu bản ghi lịch sử điều chỉnh tồn kho.
        """
        # Kiểm tra sản phẩm có tồn tại không
        prod = product_repository.get_by_item_id(db, item_id)
        if not prod:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Sản phẩm có mã SKU '{item_id}' không tồn tại.",
            )

        inv = inventory_repository.get(db, item_id, store_id)
        if not inv:
            # Tạo mới bản ghi tồn kho nếu chưa có
            inv = Inventory(
                item_id=item_id,
                store_id=store_id,
                on_hand=0.0,
                on_order=0.0,
                updated_at=datetime.now(timezone.utc),
            )
            db.add(inv)
            db.flush()

        old_on_hand = inv.on_hand
        old_on_order = inv.on_order

        # Cập nhật số liệu mới
        if request.on_hand is not None:
            inv.on_hand = float(request.on_hand)
        if request.on_order is not None:
            inv.on_order = float(request.on_order)
        inv.updated_at = datetime.now(timezone.utc)

        db.commit()
        db.refresh(inv)

        # UC14: Ghi nhật ký điều chỉnh tồn kho
        adjustment = InventoryAdjustment(
            item_id=item_id,
            store_id=store_id,
            old_on_hand=old_on_hand,
            new_on_hand=inv.on_hand,
            old_on_order=old_on_order,
            new_on_order=inv.on_order,
            reason=request.reason,
            adjusted_by=user_email,
            created_at=datetime.now(timezone.utc),
        )
        inventory_repository.record_adjustment(db, adjustment)

        # Audit log bảo mật
        audit_service.log(
            db,
            action="inventory.update",
            actor_email=user_email,
            ip_address=ip_address,
            details=f"Cập nhật tồn kho SKU '{item_id}' tại '{store_id}': on_hand ({old_on_hand} -> {inv.on_hand}), on_order ({old_on_order} -> {inv.on_order})",
        )
        db.commit()

        # Phát sự kiện Realtime Server-Sent Events (SSE)
        sse_event = create_inventory_updated_event(
            sku_id=item_id,
            actor_id=user_email or "system",
        )

        async def _publish():
            await event_bus.publish(sse_event)

        if background_tasks:
            background_tasks.add_task(_publish)
        else:
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(_publish())
            except RuntimeError:
                asyncio.run(_publish())

        return InventoryResponse(
            item_id=inv.item_id,
            store_id=inv.store_id,
            on_hand=inv.on_hand,
            on_order=inv.on_order,
            updated_at=inv.updated_at,
            product_name=prod.name,
        )

    def list_adjustments(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 50,
        item_id: Optional[str] = None,
        store_id: Optional[str] = None,
        adjusted_by: Optional[str] = None,
    ) -> InventoryAdjustmentListResponse:
        """
        UC14: Tra cứu lịch sử điều chỉnh số liệu tồn kho.
        """
        items, total = inventory_repository.list_adjustments(
            db, skip=skip, limit=limit, item_id=item_id, store_id=store_id, adjusted_by=adjusted_by
        )
        return InventoryAdjustmentListResponse(
            items=[InventoryAdjustmentResponse.model_validate(a) for a in items],
            total=total,
            skip=skip,
            limit=limit,
        )

    def get_stores(self, db: Session) -> List[str]:
        return inventory_repository.get_distinct_stores(db)


inventory_service = InventoryService()
