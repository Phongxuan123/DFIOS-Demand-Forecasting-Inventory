from datetime import datetime, timezone
import uuid
from sqlalchemy import Column, String, DateTime, JSON, Text
from app.models.base import Base


class MLTrainingJob(Base):
    """
    Model lưu trữ tiến trình và kết quả huấn luyện / benchmark mô hình dự báo (UC47).
    """
    __tablename__ = "ml_training_jobs"

    id = Column(String(50), primary_key=True, default=lambda: str(uuid.uuid4()))
    triggered_by = Column(String(100), nullable=True)
    status = Column(String(20), nullable=False, default="pending", index=True)  # pending, running, done, failed
    parameters = Column(JSON, nullable=False)
    metrics = Column(JSON, nullable=True)  # {model_name: {MAE, RMSE, MASE, WRMSSE}}
    best_model = Column(String(50), nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    completed_at = Column(DateTime, nullable=True)
