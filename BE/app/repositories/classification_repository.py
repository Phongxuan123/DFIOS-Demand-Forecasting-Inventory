from typing import Dict, List, Optional, Tuple, Any
from sqlalchemy.orm import Session
from sqlalchemy import desc, asc, func, or_

from app.models.classification import SKUClassification
from app.models.product import Product
from app.repositories.base_repository import BaseRepository


class ClassificationRepository(BaseRepository[SKUClassification]):
    def __init__(self):
        super().__init__(SKUClassification)

    def get_by_item_id(
        self, db: Session, item_id: str, store_id: Optional[str] = None
    ) -> Optional[SKUClassification]:
        query = db.query(SKUClassification).filter(SKUClassification.item_id == item_id)
        if store_id:
            query = query.filter(SKUClassification.store_id == store_id)
        return query.order_by(SKUClassification.store_id.asc()).first()

    def get_all_classifications(self, db: Session, store_id: Optional[str] = None) -> List[SKUClassification]:
        query = db.query(SKUClassification)
        if store_id:
            query = query.filter(SKUClassification.store_id == store_id)
        return query.order_by(desc(SKUClassification.revenue)).all()

    def count(self, db: Session, store_id: Optional[str] = None) -> int:
        query = db.query(SKUClassification)
        if store_id:
            query = query.filter(SKUClassification.store_id == store_id)
        return query.count()

    def list_stores(self, db: Session) -> List[str]:
        rows = db.query(SKUClassification.store_id).distinct().order_by(SKUClassification.store_id.asc()).all()
        return [r[0] for r in rows]

    def bulk_save(self, db: Session, items: List[SKUClassification], store_id: Optional[str] = None) -> None:
        """
        P-10: thay thế phân lớp của ĐÚNG MỘT kho trong một transaction (xóa + nạp rồi mới commit).
        Phân lớp của các kho khác được giữ nguyên. Lỗi giữa chừng thì rollback, dữ liệu cũ còn nguyên.
        """
        target_store = store_id or (items[0].store_id if items else None)
        try:
            query = db.query(SKUClassification)
            if target_store:
                query = query.filter(SKUClassification.store_id == target_store)
            query.delete(synchronize_session=False)
            db.add_all(items)
            db.commit()
        except Exception:
            db.rollback()
            raise

    def get_matrix_aggregation(self, db: Session, store_id: Optional[str] = None) -> Dict[str, Dict[str, Any]]:
        """
        Tổng hợp số lượng SKU và tổng doanh thu theo từng phân khúc 3x3 (của một kho nếu có store_id).
        """
        query = db.query(
            SKUClassification.segment,
            SKUClassification.abc_class,
            SKUClassification.xyz_class,
            func.count(SKUClassification.id).label("sku_count"),
            func.sum(SKUClassification.revenue).label("total_revenue"),
        )
        if store_id:
            query = query.filter(SKUClassification.store_id == store_id)
        rows = query.group_by(
            SKUClassification.segment,
            SKUClassification.abc_class,
            SKUClassification.xyz_class,
        ).all()

        result: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            result[row.segment] = {
                "segment": row.segment,
                "abc": row.abc_class,
                "xyz": row.xyz_class,
                "sku_count": int(row.sku_count or 0),
                "revenue": float(row.total_revenue or 0.0),
            }
        return result

    def filter_skus(
        self,
        db: Session,
        abc: Optional[str] = None,
        xyz: Optional[str] = None,
        segment: Optional[str] = None,
        search: Optional[str] = None,
        category: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
        sort_by: str = "revenue",
        order: str = "desc",
        store_id: Optional[str] = None,
    ) -> Tuple[int, List[Tuple[SKUClassification, Optional[str], Optional[str]]]]:
        """
        UC27 - Lọc danh sách SKU theo phân khúc ABC/XYZ, ngành hàng, tìm kiếm và phân trang.
        Trả về (total, [(SKUClassification, product_name, category), ...])
        """
        query = db.query(SKUClassification, Product.name, Product.cat_id).outerjoin(
            Product, SKUClassification.item_id == Product.item_id
        )

        if store_id:
            query = query.filter(SKUClassification.store_id == store_id)
        if segment and segment.strip():
            query = query.filter(SKUClassification.segment == segment.strip().upper())
        if abc and abc.strip():
            query = query.filter(SKUClassification.abc_class == abc.strip().upper())
        if xyz and xyz.strip():
            query = query.filter(SKUClassification.xyz_class == xyz.strip().upper())
        if category and category.strip():
            query = query.filter(Product.cat_id == category.strip())
        if search and search.strip():
            kw = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    SKUClassification.item_id.ilike(kw),
                    Product.name.ilike(kw),
                )
            )

        total = query.count()

        # Xử lý sắp xếp
        sort_col = SKUClassification.revenue
        if sort_by == "revenue_share":
            sort_col = SKUClassification.revenue_share
        elif sort_by == "cv":
            sort_col = SKUClassification.cv
        elif sort_by == "mean_demand":
            sort_col = SKUClassification.mean_demand
        elif sort_by == "item_id":
            sort_col = SKUClassification.item_id

        if order.lower() == "asc":
            query = query.order_by(asc(sort_col), asc(SKUClassification.id))
        else:
            query = query.order_by(desc(sort_col), asc(SKUClassification.id))

        results = query.offset(skip).limit(limit).all()
        return total, results


classification_repository = ClassificationRepository()
