from typing import List, Optional, Tuple
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.product import Product
from app.repositories.base_repository import BaseRepository


class ProductRepository(BaseRepository[Product]):
    def __init__(self):
        super().__init__(Product)

    def get_by_item_id(self, db: Session, item_id: str) -> Optional[Product]:
        return db.query(Product).filter(Product.item_id == item_id).first()

    def list_products(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 50,
        search: Optional[str] = None,
        dept_id: Optional[str] = None,
        cat_id: Optional[str] = None,
    ) -> Tuple[List[Product], int]:
        query = db.query(Product)

        if search and search.strip():
            kw = f"%{search.strip()}%"
            query = query.filter(or_(Product.item_id.ilike(kw), Product.name.ilike(kw)))

        if dept_id and dept_id.strip():
            query = query.filter(Product.dept_id == dept_id.strip())

        if cat_id and cat_id.strip():
            query = query.filter(Product.cat_id == cat_id.strip())

        total = query.count()
        items = query.order_by(Product.item_id.asc()).offset(skip).limit(limit).all()
        return items, total

    def delete_by_item_id(self, db: Session, item_id: str) -> bool:
        prod = self.get_by_item_id(db, item_id)
        if prod:
            db.delete(prod)
            db.commit()
            return True
        return False

    def get_distinct_categories(self, db: Session) -> List[str]:
        records = db.query(Product.cat_id).distinct().order_by(Product.cat_id.asc()).all()
        return [r[0] for r in records if r[0]]

    def get_distinct_departments(self, db: Session) -> List[str]:
        records = db.query(Product.dept_id).distinct().order_by(Product.dept_id.asc()).all()
        return [r[0] for r in records if r[0]]


product_repository = ProductRepository()
