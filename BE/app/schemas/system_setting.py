from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class SettingItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str = Field(..., description="Tên khóa tham số cấu hình")
    value: Any = Field(..., description="Giá trị cấu hình (chuỗi, số, mảng hoặc object)")
    description: Optional[str] = Field(None, description="Mô tả tham số")
    updated_at: Optional[datetime] = Field(None, description="Thời điểm cập nhật gần nhất")


class SettingsListResponse(BaseModel):
    settings: List[SettingItem] = Field(..., description="Danh sách các tham số cấu hình hệ thống")
    settings_dict: Dict[str, Any] = Field(..., description="Từ điển key-value các cấu hình giúp frontend tra cứu nhanh")


class SettingUpdateRequest(BaseModel):
    value: Any = Field(..., description="Giá trị mới cần thiết lập")
    description: Optional[str] = Field(None, description="Mô tả cập nhật (tùy chọn)")
