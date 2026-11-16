from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, DateTime, UniqueConstraint
from app.models.base import Base

CLASS_SOURCE_GROUND_TRUTH = "ground_truth"
CLASS_SOURCE_THRESHOLDS = "thresholds"
CLASS_SOURCE_LEGACY = "legacy_unverified"


class SKUClassification(Base):
    """
    Module E - Inventory Classification (ABC/XYZ):
    Lưu trữ kết quả phân loại SKU theo giá trị đóng góp (A/B/C) và mức độ biến động nhu cầu (X/Y/Z).

    P-10: phân lớp theo (item_id, store_id). Tính lại kho này không đụng tới kho khác.
    `abc_class/xyz_class/segment` là lớp HIỆU LỰC. `class_source` cho biết lớp đó lấy từ đâu:
      - "ground_truth": ánh xạ C3-OUT cố định (c3ok_sku_class.csv, research.md A5)
      - "thresholds":   tính từ ngưỡng UC25 (Pareto doanh thu + CV)
      - "legacy_unverified": dòng có từ trước khi có cột này (nguồn không được ghi lại; Q-15). Lần tính lại
        tiếp theo của kho sẽ thay bằng nguồn thật.
    `threshold_segment` luôn lưu kết quả tính theo ngưỡng UC25, kể cả khi lớp hiệu lực là ground truth,
    để hai nguồn không ghi đè lẫn nhau một cách âm thầm.
    """
    __tablename__ = "sku_classifications"
    __table_args__ = (
        UniqueConstraint("item_id", "store_id", name="uq_sku_classifications_item_store"),
    )

    id = Column(String, primary_key=True)
    item_id = Column(String, nullable=False, index=True)
    store_id = Column(String, nullable=False, default="CA_1", server_default="CA_1", index=True)
    abc_class = Column(String(1), nullable=False)  # 'A', 'B', 'C'
    xyz_class = Column(String(1), nullable=False)  # 'X', 'Y', 'Z'
    segment = Column(String(2), nullable=False, index=True)  # 'AX', 'AY', 'AZ', ...
    # Q-15: a row inserted WITHOUT an explicit source (raw SQL, legacy loader, in-place upgrade of an old table)
    # is labelled "legacy_unverified" by the database - never "ground_truth", which must be asserted explicitly.
    class_source = Column(String(20), nullable=False, default="thresholds", server_default=CLASS_SOURCE_LEGACY)
    threshold_segment = Column(String(2), nullable=True)
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
