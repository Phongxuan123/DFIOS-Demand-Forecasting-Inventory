from typing import List, Optional, Tuple
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.inventory import Inventory
from app.models.inventory_adjustment import InventoryAdjustment
from app.models.product import Product


class InventoryRepository:
    def get(self, db: Session, item_id: str, store_id: str) -> Optional[Inventory]:
        return (
            db.query(Inventory)
            .filter(Inventory.item_id == item_id, Inventory.store_id == store_id)
            .first()
        )

    def list_inventory(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 50,
        store_id: Optional[str] = None,
        item_id: Optional[str] = None,
        search: Optional[str] = None,
    ) -> Tuple[List[Tuple[Inventory, Optional[str]]], int]:
        """
        Lấy danh sách tồn kho, join kèm tên sản phẩm từ bảng products
        """
        query = db.query(Inventory, Product.name).outerjoin(
            Product, Inventory.item_id == Product.item_id
        )

        if store_id and store_id.strip():
            query = query.filter(Inventory.store_id == store_id.strip())

        if item_id and item_id.strip():
            query = query.filter(Inventory.item_id == item_id.strip())

        if search and search.strip():
            kw = f"%{search.strip()}%"
            query = query.filter(or_(Inventory.item_id.ilike(kw), Product.name.ilike(kw)))

        total = query.count()
        items = (
            query.order_by(Inventory.store_id.asc(), Inventory.item_id.asc())
            .offset(skip)
            .limit(limit)
            .all()
        )
        return items, total

    def save(self, db: Session, obj: Inventory) -> Inventory:
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    def get_distinct_stores(self, db: Session) -> List[str]:
        records = db.query(Inventory.store_id).distinct().order_by(Inventory.store_id.asc()).all()
        return [r[0] for r in records if r[0]]

    def record_adjustment(self, db: Session, adjustment: InventoryAdjustment) -> InventoryAdjustment:
        db.add(adjustment)
        db.commit()
        db.refresh(adjustment)
        return adjustment

    def list_adjustments(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 50,
        item_id: Optional[str] = None,
        store_id: Optional[str] = None,
        adjusted_by: Optional[str] = None,
    ) -> Tuple[List[InventoryAdjustment], int]:
        query = db.query(InventoryAdjustment)

        if item_id and item_id.strip():
            query = query.filter(InventoryAdjustment.item_id == item_id.strip())
        if store_id and store_id.strip():
            query = query.filter(InventoryAdjustment.store_id == store_id.strip())
        if adjusted_by and adjusted_by.strip():
            query = query.filter(InventoryAdjustment.adjusted_by.ilike(f"%{adjusted_by.strip()}%"))

        total = query.count()
        items = (
            query.order_by(InventoryAdjustment.created_at.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )
        return items, total


inventory_repository = InventoryRepository()
