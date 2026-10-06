from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict


class AuditLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    actor_email: Optional[str] = None
    action: str
    ip_address: Optional[str] = None
    details: Optional[str] = None
    created_at: datetime


class AuditLogListResponse(BaseModel):
    items: List[AuditLogResponse]
    total: int
    skip: int
    limit: int
