from datetime import date
from typing import List, Optional, Tuple
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.event import Event
from app.repositories.base_repository import BaseRepository


class EventRepository(BaseRepository[Event]):
    def __init__(self):
        super().__init__(Event)

    def list_events(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 50,
        event_type: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        search: Optional[str] = None,
    ) -> Tuple[List[Event], int]:
        query = db.query(Event)

        if event_type and event_type.strip():
            query = query.filter(Event.event_type == event_type.strip())

        if start_date:
            query = query.filter(Event.event_date >= start_date)

        if end_date:
            query = query.filter(Event.event_date <= end_date)

        if search and search.strip():
            query = query.filter(Event.event_name.ilike(f"%{search.strip()}%"))

        total = query.count()
        items = query.order_by(Event.event_date.asc(), Event.event_name.asc()).offset(skip).limit(limit).all()
        return items, total

    def get_distinct_types(self, db: Session) -> List[str]:
        records = db.query(Event.event_type).distinct().order_by(Event.event_type.asc()).all()
        return [r[0] for r in records if r[0]]

    def bulk_insert(self, db: Session, events: List[Event]) -> int:
        db.add_all(events)
        db.commit()
        return len(events)


event_repository = EventRepository()
