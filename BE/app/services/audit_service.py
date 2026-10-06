from typing import Optional
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog


class AuditService:
    """
    Dịch vụ ghi nhận nhật ký kiểm toán hệ thống (UC45).
    """
    @staticmethod
    def log(
        db: Session,
        action: str,
        actor_email: Optional[str] = None,
        ip_address: Optional[str] = None,
        details: Optional[str] = None,
    ) -> AuditLog:
        audit_entry = AuditLog(
            action=action,
            actor_email=actor_email,
            ip_address=ip_address,
            details=details,
        )
        db.add(audit_entry)
        db.flush()
        return audit_entry


audit_service = AuditService()
