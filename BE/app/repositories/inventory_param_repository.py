from typing import List, Optional, Tuple
from sqlalchemy.orm import Session
from app.models.inventory_param import InventoryParam
from app.models.product import Product


class InventoryParamRepository:
    def get_by_id(self, db: Session, param_id: str) -> Optional[InventoryParam]:
        return db.query(InventoryParam).filter(InventoryParam.id == param_id).first()

    def get_by_item_store(
        self, db: Session, item_id: str, store_id: str = "CA_1"
    ) -> Optional[InventoryParam]:
        return (
            db.query(InventoryParam)
            .filter(
                InventoryParam.item_id == item_id,
                InventoryParam.store_id == store_id,
            )
            .first()
        )

    def get_multi(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 50,
        store_id: Optional[str] = None,
        item_id: Optional[str] = None,
        category: Optional[str] = None,
        source: Optional[str] = None,
    ) -> Tuple[List[InventoryParam], int]:
        query = db.query(InventoryParam)

        if store_id:
            query = query.filter(InventoryParam.store_id == store_id)
        if item_id:
            query = query.filter(InventoryParam.item_id.ilike(f"%{item_id}%"))
        if source:
            query = query.filter(InventoryParam.source == source)
        if category:
            query = query.join(Product, InventoryParam.item_id == Product.item_id).filter(
                Product.cat_id == category
            )

        total = query.count()
        items = (
            query.order_by(InventoryParam.item_id.asc())
            .offset(skip)
            .limit(limit)
            .all()
        )
        return items, total

    def upsert(self, db: Session, param: InventoryParam) -> InventoryParam:
        existing = self.get_by_item_store(db, param.item_id, param.store_id)
        if existing:
            existing.service_level = param.service_level
            existing.lead_time_days = param.lead_time_days
            existing.safety_stock = param.safety_stock
            existing.reorder_point = param.reorder_point
            existing.eoq = param.eoq
            existing.annual_demand = param.annual_demand
            existing.holding_cost = param.holding_cost
            existing.order_cost = param.order_cost
            existing.unit_price = param.unit_price
            existing.source = param.source
            existing.updated_at = param.updated_at
            db.add(existing)
            db.commit()
            db.refresh(existing)
            return existing
        else:
            db.add(param)
            db.commit()
            db.refresh(param)
            return param

    def upsert_bulk(self, db: Session, items: List[InventoryParam]) -> int:
        count = 0
        for item in items:
            self.upsert(db, item)
            count += 1
        return count


inventory_param_repository = InventoryParamRepository()
