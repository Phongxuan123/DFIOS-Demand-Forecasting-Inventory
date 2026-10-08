import uuid
from datetime import date
from typing import List, Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.event import Event
from app.schemas.event_calendar import (
    EventCreate,
    EventUpdate,
    EventResponse,
    EventListResponse,
    EventBulkCreateRequest,
    EventBulkCreateResponse,
)
from app.repositories.event_repository import event_repository
from app.services.audit_service import audit_service


class EventCalendarService:
    """
    Dịch vụ quản lý lịch sự kiện và chương trình khuyến mãi (Covariates - UC16).
    """

    def list_events(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 50,
        event_type: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        search: Optional[str] = None,
    ) -> EventListResponse:
        items, total = event_repository.list_events(
            db,
            skip=skip,
            limit=limit,
            event_type=event_type,
            start_date=start_date,
            end_date=end_date,
            search=search,
        )
        return EventListResponse(
            items=[EventResponse.model_validate(e) for e in items],
            total=total,
            skip=skip,
            limit=limit,
        )

    def get_event(self, db: Session, id: str) -> EventResponse:
        ev = event_repository.get_by_id(db, id)
        if not ev:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy sự kiện có ID '{id}'",
            )
        return EventResponse.model_validate(ev)

    def create_event(
        self,
        db: Session,
        request: EventCreate,
        admin_email: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> EventResponse:
        ev_id = request.id.strip() if request.id and request.id.strip() else str(uuid.uuid4())
        existing = event_repository.get_by_id(db, ev_id)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Sự kiện có mã ID '{ev_id}' đã tồn tại trong hệ thống.",
            )

        new_ev = Event(
            id=ev_id,
            event_name=request.event_name.strip(),
            event_date=request.event_date,
            event_type=request.event_type.strip() if request.event_type else None,
        )
        saved = event_repository.create(db, new_ev)

        audit_service.log(
            db,
            action="event.create",
            actor_email=admin_email,
            ip_address=ip_address,
            details=f"Tạo sự kiện '{saved.event_name}' ({saved.event_date}, Loại: {saved.event_type})",
        )
        db.commit()
        return EventResponse.model_validate(saved)

    def update_event(
        self,
        db: Session,
        id: str,
        request: EventUpdate,
        admin_email: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> EventResponse:
        ev = event_repository.get_by_id(db, id)
        if not ev:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy sự kiện có ID '{id}'",
            )

        if request.event_name is not None and request.event_name.strip():
            ev.event_name = request.event_name.strip()
        if request.event_date is not None:
            ev.event_date = request.event_date
        if request.event_type is not None:
            ev.event_type = request.event_type.strip() if request.event_type else None

        db.commit()
        db.refresh(ev)

        audit_service.log(
            db,
            action="event.update",
            actor_email=admin_email,
            ip_address=ip_address,
            details=f"Cập nhật sự kiện '{ev.event_name}' (ID: {id})",
        )
        db.commit()
        return EventResponse.model_validate(ev)

    def delete_event(
        self,
        db: Session,
        id: str,
        admin_email: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> None:
        ev = event_repository.get_by_id(db, id)
        if not ev:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy sự kiện có ID '{id}'",
            )

        event_repository.delete(db, id)

        audit_service.log(
            db,
            action="event.delete",
            actor_email=admin_email,
            ip_address=ip_address,
            details=f"Xóa sự kiện '{ev.event_name}' (ID: {id})",
        )
        db.commit()

    def bulk_create_events(
        self,
        db: Session,
        request: EventBulkCreateRequest,
        admin_email: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> EventBulkCreateResponse:
        events = []
        for item in request.items:
            events.append(
                Event(
                    id=item.id.strip() if item.id and item.id.strip() else str(uuid.uuid4()),
                    event_name=item.event_name.strip(),
                    event_date=item.event_date,
                    event_type=item.event_type.strip() if item.event_type else None,
                )
            )

        inserted = event_repository.bulk_insert(db, events)

        audit_service.log(
            db,
            action="event.bulk_create",
            actor_email=admin_email,
            ip_address=ip_address,
            details=f"Import lịch sự kiện: {inserted} sự kiện mới.",
        )
        db.commit()

        return EventBulkCreateResponse(
            inserted=inserted,
            message=f"Đã thêm thành công {inserted} sự kiện vào lịch hệ thống.",
        )

    def get_event_types(self, db: Session) -> List[str]:
        return event_repository.get_distinct_types(db)


event_calendar_service = EventCalendarService()
