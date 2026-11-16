from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator


class AuditLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    actor_email: Optional[str] = None
    action: str = Field(..., description="Stable action code, e.g. 'product.update', 'auth.login_failed'")
    ip_address: Optional[str] = None
    details: Optional[str] = Field(None, description="Free text (Vietnamese) written by the service")
    created_at: datetime
    result: str = Field(
        "unknown",
        description="SUCCESS | FAILURE as RECORDED by the service that wrote the row (audit_logs.result); "
                    "'unknown' for legacy rows written before the column existed (never guessed from the text)",
    )

    @field_validator("result", mode="before")
    @classmethod
    def _legacy_unknown(cls, v):
        return v or "unknown"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def result_source(self) -> str:
        """recorded (written by the audit service) | legacy_unknown (row older than the result column)."""
        return "legacy_unknown" if self.result == "unknown" else "recorded"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def action_code(self) -> str:
        """Alias of ``action`` (already a stable, language-independent code)."""
        return self.action


class AuditLogListResponse(BaseModel):
    items: List[AuditLogResponse]
    total: int
    skip: int
    limit: int
