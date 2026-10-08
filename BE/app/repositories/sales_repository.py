from datetime import date
from typing import List, Optional, Tuple
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.sales_history import SalesHistory


class SalesRepository:
    def list_sales(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 50,
        item_id: Optional[str] = None,
        store_id: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> Tuple[List[SalesHistory], int, float, float]:
        query = db.query(SalesHistory)

        if item_id and item_id.strip():
            query = query.filter(SalesHistory.item_id == item_id.strip())

        if store_id and store_id.strip():
            query = query.filter(SalesHistory.store_id == store_id.strip())

        if start_date:
            query = query.filter(SalesHistory.sale_date >= start_date)

        if end_date:
            query = query.filter(SalesHistory.sale_date <= end_date)

        total = query.count()

        # Tính tổng sản lượng và trung bình trong tập kết quả lọc
        agg = query.with_entities(
            func.coalesce(func.sum(SalesHistory.quantity), 0.0),
            func.coalesce(func.avg(SalesHistory.quantity), 0.0),
        ).first()

        total_qty = float(agg[0]) if agg else 0.0
        avg_qty = float(agg[1]) if agg else 0.0

        items = (
            query.order_by(SalesHistory.sale_date.desc(), SalesHistory.item_id.asc())
            .offset(skip)
            .limit(limit)
            .all()
        )
        return items, total, total_qty, avg_qty

    def get_summary(
        self,
        db: Session,
        item_id: Optional[str] = None,
        store_id: Optional[str] = None,
    ) -> Tuple[int, Optional[date], Optional[date], float]:
        query = db.query(SalesHistory)
        if item_id and item_id.strip():
            query = query.filter(SalesHistory.item_id == item_id.strip())
        if store_id and store_id.strip():
            query = query.filter(SalesHistory.store_id == store_id.strip())

        row = query.with_entities(
            func.count(SalesHistory.id),
            func.min(SalesHistory.sale_date),
            func.max(SalesHistory.sale_date),
            func.coalesce(func.sum(SalesHistory.quantity), 0.0),
        ).first()

        if not row or row[0] == 0:
            return 0, None, None, 0.0

        return int(row[0]), row[1], row[2], float(row[3])

    def create(self, db: Session, record: SalesHistory) -> SalesHistory:
        db.add(record)
        db.commit()
        db.refresh(record)
        return record

    def bulk_insert(self, db: Session, records: List[SalesHistory]) -> int:
        db.add_all(records)
        db.commit()
        return len(records)


sales_repository = SalesRepository()
