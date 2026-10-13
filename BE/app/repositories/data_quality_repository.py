from typing import List, Optional, Tuple
from sqlalchemy.orm import Session
from app.models.data_quality import DataQualityRun
from app.repositories.base_repository import BaseRepository


class DataQualityRepository(BaseRepository[DataQualityRun]):
    def __init__(self):
        super().__init__(DataQualityRun)

    def get_by_id(self, db: Session, run_id: str) -> Optional[DataQualityRun]:
        return db.query(DataQualityRun).filter(DataQualityRun.id == run_id).first()

    def list_runs(
        self, db: Session, skip: int = 0, limit: int = 20
    ) -> Tuple[List[DataQualityRun], int]:
        query = db.query(DataQualityRun).order_by(DataQualityRun.created_at.desc())
        total = query.count()
        items = query.offset(skip).limit(limit).all()
        return items, total


data_quality_repository = DataQualityRepository()
