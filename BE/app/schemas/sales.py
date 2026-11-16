from datetime import date
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    # R-38: bộ field thống nhất với POST /imports (FE đọc inserted/updated/rejected).
    # Round 5: /sales/import tách thêm mới (`inserted`) và cập nhật dòng đã có (`updated`);
    # imported_count = inserted + updated.
    inserted: Optional[int] = None
    updated: int = 0
    rejected: Optional[int] = None
    duplicate_rows: int = Field(0, description="Rows of the file repeating an (item, store, day) already in the file (last value kept)")

    @model_validator(mode="after")
    def _fill_unified_counters(self) -> "SalesImportResponse":
        if self.inserted is None:
            self.inserted = self.imported_count
        if self.rejected is None:
            self.rejected = self.skipped_count
        return self
