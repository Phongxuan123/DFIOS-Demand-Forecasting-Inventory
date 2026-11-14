from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


class ProductBase(BaseModel):
    item_id: str = Field(..., description="Mã SKU sản phẩm (duy nhất)")
    name: str = Field(..., description="Tên sản phẩm")
    dept_id: Optional[str] = Field(None, description="Mã bộ phận/ngành hàng (Department)")
    cat_id: Optional[str] = Field(None, description="Mã danh mục (Category)")


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    name: Optional[str] = Field(None, description="Tên sản phẩm mới")
    dept_id: Optional[str] = Field(None, description="Mã bộ phận/ngành hàng mới")
    cat_id: Optional[str] = Field(None, description="Mã danh mục mới")


class ProductResponse(ProductBase):
    model_config = ConfigDict(from_attributes=True)

    price: Optional[float] = Field(None, description="Giá bán (USD)")
    # list view only (one joined query, store_id param; sums stores when omitted) - null on single-item routes
    on_hand: Optional[float] = None
    s: Optional[float] = Field(None, description="Reorder point s of (R,s,S)")
    S: Optional[float] = Field(None, description="Order-up-to level S of (R,s,S)")


class ProductListResponse(BaseModel):
    items: List[ProductResponse]
    total: int
    skip: int
    limit: int


class ProductBulkCreateRequest(BaseModel):
    items: List[ProductCreate]


class ProductBulkCreateResponse(BaseModel):
    inserted: int
    skipped: int
    message: str
