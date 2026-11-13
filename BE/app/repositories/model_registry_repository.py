from typing import List, Optional, Tuple
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.models.model_registry import ModelRegistry
from app.repositories.base_repository import BaseRepository


class ModelRegistryRepository(BaseRepository[ModelRegistry]):
    def __init__(self):
        super().__init__(ModelRegistry)

    def get_by_id(self, db: Session, model_id: str) -> Optional[ModelRegistry]:
        return db.query(ModelRegistry).filter(ModelRegistry.id == model_id).first()

    def get_production_model(self, db: Session, scope: str = "global") -> Optional[ModelRegistry]:
        return (
            db.query(ModelRegistry)
            .filter(ModelRegistry.scope == scope, ModelRegistry.is_production == True)
            .order_by(ModelRegistry.promoted_at.desc(), ModelRegistry.created_at.desc())
            .first()
        )

    def promote_model(
        self, db: Session, model_id: str
    ) -> Tuple[Optional[ModelRegistry], Optional[str]]:
        target_model = self.get_by_id(db, model_id)
        if not target_model:
            return None, None

        # 1. Tìm tất cả phiên bản production cũ cùng scope để hạ cấp (B-03)
        old_prods = (
            db.query(ModelRegistry)
            .filter(
                ModelRegistry.scope == target_model.scope,
                ModelRegistry.is_production == True,
                ModelRegistry.id != target_model.id,
            )
            .all()
        )
        demoted_ids = []
        for old in old_prods:
            old.is_production = False
            demoted_ids.append(old.id)
        demoted_id = demoted_ids[0] if demoted_ids else None

        # 2. Thăng hạng phiên bản mới
        target_model.is_production = True
        target_model.promoted_at = datetime.now(timezone.utc)

        db.commit()
        db.refresh(target_model)
        return target_model, demoted_id

    def list_models(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 20,
        is_production: Optional[bool] = None,
        algorithm: Optional[str] = None,
        scope: Optional[str] = None,
    ) -> Tuple[List[ModelRegistry], int]:
        query = db.query(ModelRegistry)
        if is_production is not None:
            query = query.filter(ModelRegistry.is_production == is_production)
        if algorithm:
            query = query.filter(ModelRegistry.algorithm == algorithm.lower().strip())
        if scope:
            query = query.filter(ModelRegistry.scope == scope.strip())

        query = query.order_by(ModelRegistry.is_production.desc(), ModelRegistry.created_at.desc())
        total = query.count()
        items = query.offset(skip).limit(limit).all()
        return items, total


model_registry_repository = ModelRegistryRepository()
