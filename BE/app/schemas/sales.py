from datetime import date
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


class SaleRecordBase(BaseModel):
    item_id: str = Field(..., description="Mã SKU sản phẩm")
    store_id: str = Field(..., description="Mã cửa hàng / kho")
    sale_date: date = Field(..., description="Ngày bán hàng (YYYY-MM-DD)")
    quantity: float = Field(..., ge=0, description="Số lượng bán ra (>= 0)")


class SaleRecordCreate(SaleRecordBase):
    pass


class SaleRecordResponse(SaleRecordBase):
    model_config = ConfigDict(from_attributes=True)

    id: Optional[str] = None


class SalesQueryResponse(BaseModel):
    items: List[SaleRecordResponse]
    total: int
    skip: int
    limit: int
    total_quantity: float
    average_quantity: float


class SalesSummaryResponse(BaseModel):
    item_id: Optional[str] = None
    store_id: Optional[str] = None
    total_records: int
    min_date: Optional[date] = None
    max_date: Optional[date] = None
    total_quantity: float


class SalesImportResponse(BaseModel):
    imported_count: int
    skipped_count: int
    message: str
