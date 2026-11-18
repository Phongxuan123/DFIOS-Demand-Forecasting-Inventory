"""P3-F4 / H1: without daily-origin window quantiles (only weekly forecast_backtest reviews) what-if R = 1 is a
structured 422 whose r_options = [7]; R = 7 is accepted; dash_avail_b0 label. R = 1 WITH daily teacher rows:
test_h1_whatif_daily.py."""
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.forecast_backtest import ForecastBacktest
from app.schemas.simulation import WhatIfRequest
from app.services.what_if_service import what_if_service


def _db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)()
    for k, day in enumerate([1000, 1007, 1014, 1021]):
        db.add(ForecastBacktest(id=f"b{k}", store_id="CA_1", item_id="X", review_day=day, dhat=10.0,
                                dhat_lgb=10.0, sigma_d=1.0))
    db.commit()
    return db


def test_r1_is_structured_422_with_r_options():
    db = _db()
    with pytest.raises(HTTPException) as ei:
        what_if_service.run(db, WhatIfRequest(store_id="CA_1", review_period_days=1))
    assert ei.value.status_code == 422
    d = ei.value.detail
    assert d["reason_code"] == "unsupported_review_period"
    assert d["r_options"] == [7] and d["supported_review_period_days"] == [7]
    assert "R = 1" in d["reason"] and "--daily-origins" in d["reason"]


def test_r7_passes_review_period_gate():
    db = _db()
    with pytest.raises(HTTPException) as ei:  # passes the R gate, fails later for lack of classified SKUs
        what_if_service.run(db, WhatIfRequest(store_id="CA_1", review_period_days=7))
    assert ei.value.detail["reason_code"] != "unsupported_review_period"


def test_dashboard_b0_label_is_teacher_b0():
    import inspect
    from app.services import dashboard_service
    src = inspect.getsource(dashboard_service)
    assert "B0-MA-OUT-0.95 (đúng B0 của thầy)" in src
    assert "B0 raw quantile" not in src
