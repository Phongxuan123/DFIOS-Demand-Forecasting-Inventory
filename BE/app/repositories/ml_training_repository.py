from typing import List, Optional, Tuple
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.models.ml_training import MLTrainingJob
from app.repositories.base_repository import BaseRepository


class MLTrainingRepository(BaseRepository[MLTrainingJob]):
    def __init__(self):
        super().__init__(MLTrainingJob)

    def get_by_id(self, db: Session, job_id: str) -> Optional[MLTrainingJob]:
        return db.query(MLTrainingJob).filter(MLTrainingJob.id == job_id).first()

    def update_job_status(
        self,
        db: Session,
        job_id: str,
        status: str,
        metrics: Optional[dict] = None,
        best_model: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> Optional[MLTrainingJob]:
        job = self.get_by_id(db, job_id)
        if not job:
            return None

        job.status = status
        if metrics is not None:
            job.metrics = metrics
        if best_model is not None:
            job.best_model = best_model
        if error_message is not None:
            job.error_message = error_message
        if status in ("done", "failed"):
            job.completed_at = datetime.now(timezone.utc)

        db.commit()
        db.refresh(job)
        return job

    def list_jobs(
        self, db: Session, skip: int = 0, limit: int = 20
    ) -> Tuple[List[MLTrainingJob], int]:
        query = db.query(MLTrainingJob).order_by(MLTrainingJob.created_at.desc())
        total = query.count()
        items = query.offset(skip).limit(limit).all()
        return items, total


ml_training_repository = MLTrainingRepository()
