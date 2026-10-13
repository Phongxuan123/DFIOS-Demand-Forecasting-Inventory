from datetime import datetime, timezone
import uuid
from sqlalchemy import Column, String, DateTime, Boolean, JSON, Text
from app.models.base import Base


class ModelRegistry(Base):
    """
    Model lưu trữ kho phiên bản mô hình ML và đánh dấu bản Production (UC48).
    """
    __tablename__ = "model_registry"

    id = Column(String(50), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100), nullable=False, index=True)
    version = Column(String(50), nullable=False)
    algorithm = Column(String(50), nullable=False, index=True)  # lightgbm, xgboost, baseline_naive...
    scope = Column(String(100), nullable=False, default="global", index=True)  # global, hoặc theo SKU/nhóm
    is_production = Column(Boolean, nullable=False, default=False, index=True)
    parameters = Column(JSON, nullable=True)  # Hyperparameters (learning_rate, n_estimators...)
    metrics = Column(JSON, nullable=True)  # {mae, rmse, mase, wrmsse}
    trained_by = Column(String(100), nullable=True)
    job_id = Column(String(50), nullable=True, index=True)  # ID lượt train tương ứng từ UC47
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    promoted_at = Column(DateTime, nullable=True)
