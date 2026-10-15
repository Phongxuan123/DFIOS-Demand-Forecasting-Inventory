from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


class SupplierBase(BaseModel):
    name: str = Field(..., description="Tên nhà cung cấp")
    lead_time_days: int = Field(..., ge=1, le=365, description="Thời gian giao hàng (Lead Time) tính bằng ngày (1 - 365)")
    contact_name: Optional[str] = Field(None, description="Tên người liên hệ")
    email: Optional[str] = Field(None, description="Email liên hệ")
    phone: Optional[str] = Field(None, description="Số điện thoại")
    address: Optional[str] = Field(None, description="Địa chỉ")


class SupplierCreate(SupplierBase):
    id: Optional[str] = Field(None, description="Mã nhà cung cấp (tùy chọn, tự động sinh UUID nếu để trống)")


class SupplierUpdate(BaseModel):
    name: Optional[str] = Field(None, description="Tên nhà cung cấp mới")
    lead_time_days: Optional[int] = Field(None, ge=1, le=365, description="Lead Time mới (ngày)")
    contact_name: Optional[str] = Field(None, description="Tên người liên hệ mới")
    email: Optional[str] = Field(None, description="Email liên hệ mới")
    phone: Optional[str] = Field(None, description="Số điện thoại mới")
    address: Optional[str] = Field(None, description="Địa chỉ mới")


class SupplierResponse(SupplierBase):
    model_config = ConfigDict(from_attributes=True)

    id: str


class SupplierListResponse(BaseModel):
    items: List[SupplierResponse]
    total: int
    skip: int
    limit: int
