"""
batch_runs (research.md §10 / demo.md §3, §5 Admin "Lịch sử batch", E7): one row per batch job execution.

A clock advance writes one ``ADVANCE`` row (the whole call) plus one row per job it ran: ``J1`` (arrivals + sales
replay of the advanced days, aggregated), and per review ``J6`` (close the cycle k - d), ``J5`` (refit), ``J3``
(window quantiles), ``J4`` (C3-OUT step + parameters + orders). All rows of one call share ``run_id``. A failed
advance is rolled back as a whole; its ``ADVANCE`` row is then written alone with status ``failed`` and the error.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Column, Date, DateTime, Float, Integer, String, Text

from app.models.base import Base


class BatchRun(Base):
    __tablename__ = "batch_runs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id = Column(String(36), nullable=False, index=True)   # groups the rows of one call (= job id of the API)
    job = Column(String(20), nullable=False, index=True)       # ADVANCE | J1 | J3 | J4 | J5 | J6
    store_id = Column(String(20), nullable=True, index=True)
    sim_date = Column(Date, nullable=True)                     # simulated day of the job (review day; last day for J1)
    review_index = Column(Integer, nullable=True)
    status = Column(String(20), nullable=False, default="success")  # queued | running | success | failed
    started_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), index=True)
    finished_at = Column(DateTime, nullable=True)
    duration_ms = Column(Float, nullable=True)
    n_items = Column(Integer, nullable=True)                   # SKUs (or orders for J4) processed
    triggered_by = Column(String(120), nullable=True)
    error = Column(Text, nullable=True)
    details = Column(JSON, nullable=True)
