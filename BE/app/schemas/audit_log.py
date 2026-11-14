from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, computed_field


class AuditLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    actor_email: Optional[str] = None
    action: str
    ip_address: Optional[str] = None
    details: Optional[str] = None
    created_at: datetime

    @computed_field  # type: ignore[prop-decorator]
    @property
    def result(self) -> str:
        """SUCCESS | FAILURE, DERIVED from action/details (the table has no status column; every
        service writes its audit row on the success path, so FAILURE only appears for explicit failure actions)."""
        text = f"{self.action} {self.details or ''}".lower()
        return "FAILURE" if any(k in text for k in ("fail", "denied", "invalid", "error", "locked")) else "SUCCESS"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def result_source(self) -> str:
        return "derived_from_action"


class AuditLogListResponse(BaseModel):
    items: List[AuditLogResponse]
    total: int
    skip: int
    limit: int
