from datetime import datetime
from typing import Optional, List, Tuple
from sqlalchemy.orm import Session

from app.models.audit_log import AUDIT_RESULT_FAILURE, AUDIT_RESULT_SUCCESS, AuditLog


class AuditService:
    """
    Dịch vụ ghi nhận và tra cứu nhật ký kiểm toán hệ thống (UC45).
    """
    @staticmethod
    def log(
        db: Session,
        action: str,
        actor_email: Optional[str] = None,
        ip_address: Optional[str] = None,
        details: Optional[str] = None,
        result: str = AUDIT_RESULT_SUCCESS,
    ) -> AuditLog:
        """Write one audit row. ``result`` is the outcome RECORDED by the caller: SUCCESS (default, the row is
        written on the success path of the operation) or FAILURE (failed / rejected attempt)."""
        if result not in (AUDIT_RESULT_SUCCESS, AUDIT_RESULT_FAILURE):
            raise ValueError(f"audit result must be {AUDIT_RESULT_SUCCESS} or {AUDIT_RESULT_FAILURE}, got {result!r}")
        audit_entry = AuditLog(
            action=action,
            actor_email=actor_email,
            ip_address=ip_address,
            details=details,
            result=result,
        )
        db.add(audit_entry)
        db.flush()
        return audit_entry

    @staticmethod
    def list_logs(
        db: Session,
        skip: int = 0,
        limit: int = 50,
        action: Optional[str] = None,
        actor_email: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        result: Optional[str] = None,
    ) -> Tuple[List[AuditLog], int]:
        """
        UC45: Lọc và phân trang nhật ký hoạt động hệ thống. ``result``: SUCCESS | FAILURE | unknown.
        """
        query = db.query(AuditLog)
        if result and result.strip():
            r = result.strip()
            query = query.filter(AuditLog.result == ("unknown" if r.lower() == "unknown" else r.upper()))

        if action and action.strip():
            query = query.filter(AuditLog.action.ilike(f"%{action.strip()}%"))
        if actor_email and actor_email.strip():
            query = query.filter(AuditLog.actor_email.ilike(f"%{actor_email.strip()}%"))
        if start_time:
            query = query.filter(AuditLog.created_at >= start_time)
        if end_time:
            query = query.filter(AuditLog.created_at <= end_time)

        total = query.count()
        items = (
            query.order_by(AuditLog.created_at.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )
        return items, total

    @staticmethod
    def get_distinct_actions(db: Session) -> List[str]:
        """
        UC45: Lấy danh sách các loại hành động duy nhất có trong hệ thống để lọc nhanh trên UI.
        """
        records = (
            db.query(AuditLog.action)
            .distinct()
            .order_by(AuditLog.action.asc())
            .all()
        )
        return [r[0] for r in records if r[0]]


audit_service = AuditService()
