from typing import List, Optional, Tuple
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.supplier import Supplier
from app.repositories.base_repository import BaseRepository


class SupplierRepository(BaseRepository[Supplier]):
    def __init__(self):
        super().__init__(Supplier)

    def list_suppliers(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 50,
        search: Optional[str] = None,
    ) -> Tuple[List[Supplier], int]:
        query = db.query(Supplier)

        if search and search.strip():
            kw = f"%{search.strip()}%"
            query = query.filter(or_(Supplier.id.ilike(kw), Supplier.name.ilike(kw)))

        total = query.count()
        items = query.order_by(Supplier.name.asc()).offset(skip).limit(limit).all()
        return items, total


supplier_repository = SupplierRepository()
