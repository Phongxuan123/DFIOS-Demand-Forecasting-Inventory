from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, DateTime
from app.models.base import Base


class SKUClassification(Base):
    """
    Module E - Inventory Classification (ABC/XYZ):
    Lưu trữ kết quả phân loại SKU theo giá trị đóng góp (A/B/C) và mức độ biến động nhu cầu (X/Y/Z).
    """
    __tablename__ = "sku_classifications"

    id = Column(String, primary_key=True)
    item_id = Column(String, nullable=False, unique=True, index=True)
    abc_class = Column(String(1), nullable=False)  # 'A', 'B', 'C'
    xyz_class = Column(String(1), nullable=False)  # 'X', 'Y', 'Z'
    segment = Column(String(2), nullable=False, index=True)  # 'AX', 'AY', 'AZ', ...
    revenue = Column(Float, nullable=False, default=0.0)  # Tổng doanh thu
    revenue_share = Column(Float, nullable=False, default=0.0)  # Tỷ trọng doanh thu (%)
    cumulative_share = Column(Float, nullable=False, default=0.0)  # Tỷ trọng tích lũy (%)
    mean_demand = Column(Float, nullable=False, default=0.0)  # Nhu cầu trung bình ngày (mu)
    std_demand = Column(Float, nullable=False, default=0.0)  # Độ lệch chuẩn nhu cầu ngày (sigma)
    cv = Column(Float, nullable=False, default=0.0)  # Hệ số biến động CV = sigma / mu
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
