"""
Planner role (demo.md §5): view forecasts, override a forecast with a reason, edit and approve orders. Manager-only
and Admin-only actions stay closed to the Planner. Tiny SQLite panel, real routes, real JWT.
"""
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.models.base import Base
from app.models.inventory import Inventory
from app.models.product import Product
from app.models.replenishment import ReplenishmentRecommendation
from app.models.sim_clock import SimClock
from app.models.user import User

CLOCK = date(2016, 4, 25)
STORE = "CA_1"
ITEM = "FOODS_1_001"


@pytest.fixture()
def planner_client():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)

    def override():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
    db = Session()
    db.add(User(id="p1", email="planner@dfios.com", password_hash=get_password_hash("Planner123"), role="Planner",
                display_name="Planner", is_active=True, is_verified=True, token_version=1))
    db.add(SimClock(store_id=STORE, current_date=CLOCK, start_date=CLOCK))
    db.add(Product(item_id=ITEM, name="Item", cat_id="FOODS", dept_id="FOODS_1", price=2.0))
    db.add(Inventory(item_id=ITEM, store_id=STORE, on_hand=1.0, on_order=0.0))
    db.add(ReplenishmentRecommendation(id="r1", item_id=ITEM, store_id=STORE, recommended_qty=10, final_qty=10,
                                       status="PENDING", review_date=CLOCK, origin="simulator"))
    db.commit()
    token = create_access_token(data={"sub": "planner@dfios.com", "role": "Planner", "user_id": "p1",
                                      "token_version": 1})
    client = TestClient(app)
    client.headers.update({"Authorization": f"Bearer {token}"})
    yield client, db
    db.close()
    app.dependency_overrides.pop(get_db, None)


def test_planner_lists_edits_and_approves_orders(planner_client):
    client, db = planner_client
    assert client.get("/api/v1/replenishments", params={"store_id": STORE}).status_code == 200
    r = client.patch("/api/v1/replenishments/r1", json={"final_qty": 6, "reason": "shelf space"})
    assert r.status_code == 200, r.text
    r = client.post("/api/v1/replenishments/r1/approve")
    assert r.status_code == 200, r.text
    db.expire_all()
    rec = db.get(ReplenishmentRecommendation, "r1")
    assert (rec.status, rec.final_qty, rec.recommended_qty, rec.decided_by) == ("APPROVED", 6.0, 10.0,
                                                                                  "planner@dfios.com")
    assert db.query(Inventory).one().on_order == 6.0


def test_planner_sees_the_sim_clock(planner_client):
    client, _ = planner_client
    assert client.get("/api/v1/clock", params={"store_id": STORE}).status_code == 200


@pytest.mark.parametrize("method,path,body", [
    ("post", "/api/v1/clock/advance", {"store_id": STORE, "days": 1}),     # Admin: sim_clock control
    ("post", "/api/v1/clock/reset", {"store_id": STORE}),
    ("post", "/api/v1/optimization/refit-policies", {}),                  # Manager: run J5
    ("post", "/api/v1/classification/recompute", {}),
    ("get", "/api/v1/users", None),                                        # Admin: user management
])
def test_planner_cannot_run_manager_or_admin_actions(planner_client, method, path, body):
    client, _ = planner_client
    r = getattr(client, method)(path, json=body) if body is not None else getattr(client, method)(path)
    assert r.status_code == 403, (path, r.status_code, r.text)


def test_planner_is_a_valid_role_for_user_creation():
    from app.schemas.user import UserCreateRequest

    fields = UserCreateRequest.model_fields
    assert "Planner" in str(fields["role"].annotation)
