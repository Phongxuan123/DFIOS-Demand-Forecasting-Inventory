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
