from datetime import datetime
from typing import List, Optional, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import or_, desc

from app.models.replenishment import ReplenishmentRecommendation


class ReplenishmentRepository:
    def get(self, db: Session, rec_id: str) -> Optional[ReplenishmentRecommendation]:
        return (
            db.query(ReplenishmentRecommendation)
            .filter(ReplenishmentRecommendation.id == rec_id)
            .first()
        )

    def get_pending_by_sku_store(
        self, db: Session, item_id: str, store_id: str = "CA_1"
    ) -> Optional[ReplenishmentRecommendation]:
        """
        Tìm đề xuất đang ở trạng thái PENDING của SKU tại store để chống sinh trùng lặp.
        """
        return (
            db.query(ReplenishmentRecommendation)
            .filter(
                ReplenishmentRecommendation.item_id == item_id,
                ReplenishmentRecommendation.store_id == store_id,
                ReplenishmentRecommendation.status == "PENDING",
            )
            .first()
        )

    def list_recommendations(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 50,
        store_id: Optional[str] = None,
        status: Optional[str] = None,
        priority: Optional[str] = None,
        search: Optional[str] = None,
        item_id: Optional[str] = None,
    ) -> Tuple[List[ReplenishmentRecommendation], int]:
        query = db.query(ReplenishmentRecommendation)

        if store_id:
            query = query.filter(ReplenishmentRecommendation.store_id == store_id)
        if status:
            query = query.filter(ReplenishmentRecommendation.status == status)
        if priority:
            query = query.filter(ReplenishmentRecommendation.priority == priority)
        if item_id:
            query = query.filter(ReplenishmentRecommendation.item_id == item_id)
        if search:
            query = query.filter(
                or_(
                    ReplenishmentRecommendation.item_id.ilike(f"%{search}%"),
                    ReplenishmentRecommendation.reason.ilike(f"%{search}%"),
                )
            )

        total = query.count()
        # Sắp xếp ưu tiên: HIGH -> MEDIUM -> LOW, sau đó đến ngày tạo mới nhất
        items = (
            query.order_by(
                desc(ReplenishmentRecommendation.created_at)
            )
            .offset(skip)
            .limit(limit)
            .all()
        )
        return items, total

    def list_history(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 50,
        store_id: Optional[str] = None,
        item_id: Optional[str] = None,
        status: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> Tuple[List[ReplenishmentRecommendation], int]:
        query = db.query(ReplenishmentRecommendation)

        # Mặc định lịch sử là các đơn đã qua xử lý (APPROVED, REJECTED, CANCELLED) nếu không chỉ định status
        if status:
            query = query.filter(ReplenishmentRecommendation.status == status)
        else:
            query = query.filter(ReplenishmentRecommendation.status.in_(["APPROVED", "REJECTED", "CANCELLED"]))

        if store_id:
            query = query.filter(ReplenishmentRecommendation.store_id == store_id)
        if item_id:
            query = query.filter(ReplenishmentRecommendation.item_id.ilike(f"%{item_id}%"))
        if start_date:
            query = query.filter(ReplenishmentRecommendation.created_at >= start_date)
        if end_date:
            query = query.filter(ReplenishmentRecommendation.created_at <= end_date)

        total = query.count()
        items = (
            query.order_by(desc(ReplenishmentRecommendation.decided_at), desc(ReplenishmentRecommendation.created_at))
            .offset(skip)
            .limit(limit)
            .all()
        )
        return items, total

    def create(self, db: Session, rec: ReplenishmentRecommendation) -> ReplenishmentRecommendation:
        db.add(rec)
        db.commit()
        db.refresh(rec)
        return rec

    def save_bulk(self, db: Session, recs: List[ReplenishmentRecommendation]) -> int:
        if not recs:
            return 0
        db.add_all(recs)
        db.commit()
        return len(recs)

    def update(self, db: Session, rec: ReplenishmentRecommendation) -> ReplenishmentRecommendation:
        db.add(rec)
        db.commit()
        db.refresh(rec)
        return rec


replenishment_repository = ReplenishmentRepository()
