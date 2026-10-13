from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict


class DataQualityRunRequest(BaseModel):
    item_ids: Optional[List[str]] = Field(None, description="Danh sách SKU cần kiểm tra (None = tất cả)")
    store_id: Optional[str] = Field(None, description="Mã cửa hàng/kho cần kiểm tra")
    cutoff_date: Optional[date] = Field(None, description="Mốc thời gian dự báo (kiểm tra rò rỉ dữ liệu sau cutoff)")
    max_missing_rate: float = Field(0.05, ge=0.0, le=1.0, description="Ngưỡng tỷ lệ thiếu dữ liệu tối đa chấp nhận (0.05 = 5%)")
    outlier_threshold_std: float = Field(3.0, ge=1.0, le=10.0, description="Ngưỡng Z-score phát hiện ngoại lai (mặc định 3.0)")


class DataQualityIssue(BaseModel):
    check_type: str = Field(..., description="Loại kiểm tra: MISSING_VALUES, NEGATIVE_VALUE, DUPLICATE_DATE, UNKNOWN_SKU, OUTLIER, DATA_LEAKAGE, EMPTY_DATA")
    item_id: Optional[str] = None
    store_id: Optional[str] = None
    severity: str = Field(..., description="Mức độ nghiêm trọng: LOW, MEDIUM, HIGH, CRITICAL")
    message: str = Field(..., description="Chi tiết cảnh báo / lỗi")
    metric_value: Optional[float] = None


class DataQualitySummary(BaseModel):
    total_records: int = 0
    missing_rate: float = 0.0
    outliers_count: int = 0
    negative_values_count: int = 0
    duplicate_dates_count: int = 0
    invalid_sku_count: int = 0
    leakage_detected: bool = False


class DataQualityRunResponse(BaseModel):
    id: str
    status: str = Field(..., description="Trạng thái: PASSED, WARNING, FAILED")
    passed: bool
    triggered_by: Optional[str] = None
    summary: DataQualitySummary
    issues: List[DataQualityIssue] = []
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DataQualityRunListResponse(BaseModel):
    items: List[DataQualityRunResponse]
    total: int
