from datetime import date
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


class EventBase(BaseModel):
    event_name: str = Field(..., description="Tên sự kiện / ngày lễ / chương trình khuyến mãi")
    event_date: date = Field(..., description="Ngày diễn ra sự kiện (YYYY-MM-DD)")
    event_type: Optional[str] = Field(None, description="Loại sự kiện (ví dụ: Sporting, Cultural, National, Religious, Promotion)")


class EventCreate(EventBase):
    id: Optional[str] = Field(None, description="Mã sự kiện (tự sinh UUID nếu để trống)")


class EventUpdate(BaseModel):
    event_name: Optional[str] = Field(None, description="Tên sự kiện mới")
    event_date: Optional[date] = Field(None, description="Ngày sự kiện mới (YYYY-MM-DD)")
    event_type: Optional[str] = Field(None, description="Loại sự kiện mới")


class EventResponse(EventBase):
    model_config = ConfigDict(from_attributes=True)

    id: str


class EventListResponse(BaseModel):
    items: List[EventResponse]
    total: int
    skip: int
    limit: int


class EventBulkCreateRequest(BaseModel):
    items: List[EventCreate]


class EventBulkCreateResponse(BaseModel):
    inserted: int
    message: str
