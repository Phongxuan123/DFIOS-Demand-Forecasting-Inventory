from typing import Dict, List, Optional, Tuple, Any
from sqlalchemy.orm import Session
from sqlalchemy import desc, asc, func, or_

from app.models.classification import SKUClassification
from app.models.product import Product
from app.repositories.base_repository import BaseRepository


class ClassificationRepository(BaseRepository[SKUClassification]):
    def __init__(self):
        super().__init__(SKUClassification)

    def get_by_item_id(self, db: Session, item_id: str) -> Optional[SKUClassification]:
        return db.query(SKUClassification).filter(SKUClassification.item_id == item_id).first()

    def get_all_classifications(self, db: Session) -> List[SKUClassification]:
        return db.query(SKUClassification).order_by(desc(SKUClassification.revenue)).all()

    def count(self, db: Session) -> int:
        return db.query(SKUClassification).count()

    def bulk_save(self, db: Session, items: List[SKUClassification]) -> None:
        """
        Xóa và lưu lại bảng phân loại SKU để đảm bảo đồng bộ hoàn toàn với ngưỡng mới.
        """
        db.query(SKUClassification).delete()
        db.add_all(items)
        db.commit()

    def get_matrix_aggregation(self, db: Session) -> Dict[str, Dict[str, Any]]:
        """
        Tổng hợp số lượng SKU và tổng doanh thu theo từng phân khúc 3x3.
        """
        rows = (
            db.query(
                SKUClassification.segment,
                SKUClassification.abc_class,
                SKUClassification.xyz_class,
                func.count(SKUClassification.id).label("sku_count"),
                func.sum(SKUClassification.revenue).label("total_revenue"),
            )
            .group_by(
                SKUClassification.segment,
                SKUClassification.abc_class,
                SKUClassification.xyz_class,
            )
            .all()
        )

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
    ) -> Tuple[int, List[Tuple[SKUClassification, Optional[str], Optional[str]]]]:
        """
        UC27 - Lọc danh sách SKU theo phân khúc ABC/XYZ, ngành hàng, tìm kiếm và phân trang.
        Trả về (total, [(SKUClassification, product_name, category), ...])
        """
        query = db.query(SKUClassification, Product.name, Product.cat_id).outerjoin(
            Product, SKUClassification.item_id == Product.item_id
        )

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
            query = query.order_by(asc(sort_col))
        else:
            query = query.order_by(desc(sort_col))

        results = query.offset(skip).limit(limit).all()
        return total, results


classification_repository = ClassificationRepository()
