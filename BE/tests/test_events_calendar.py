import unittest
from datetime import date
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.models.base import Base
from app.models.user import User
from app.models.event import Event
from app.core.security import get_password_hash, create_access_token
from app.api.deps import get_db


class TestEventsCalendarEndpoints(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.TestingSessionLocal = sessionmaker(
            autocommit=False, autoflush=False, bind=self.engine, expire_on_commit=False
        )
        Base.metadata.create_all(bind=self.engine)

        def override_get_db():
            db = self.TestingSessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db

        with self.TestingSessionLocal() as session:
            admin = User(
                id="admin-01",
                email="admin@dfios.com",
                password_hash=get_password_hash("Admin123"),
                role="Admin",
                display_name="System Admin",
                is_active=True,
                is_verified=True,
                token_version=1,
            )
            viewer = User(
                id="viewer-01",
                email="viewer@dfios.com",
                password_hash=get_password_hash("Viewer123"),
                role="Viewer",
                display_name="Warehouse Viewer",
                is_active=True,
                is_verified=True,
                token_version=1,
            )
            ev1 = Event(
                id="ev-01",
                event_name="SuperBowl",
                event_date=date(2016, 2, 7),
                event_type="Sporting",
            )
            ev2 = Event(
                id="ev-02",
                event_name="Valentines Day",
                event_date=date(2016, 2, 14),
                event_type="Cultural",
            )
            ev3 = Event(
                id="ev-03",
                event_name="Presidents Day",
                event_date=date(2016, 2, 15),
                event_type="National",
            )
            session.add_all([admin, viewer, ev1, ev2, ev3])
            session.commit()

        self.admin_token = create_access_token(
            data={"sub": "admin@dfios.com", "role": "Admin", "user_id": "admin-01", "token_version": 1}
        )
        self.viewer_token = create_access_token(
            data={"sub": "viewer@dfios.com", "role": "Viewer", "user_id": "viewer-01", "token_version": 1}
        )
        self.client = TestClient(app)

    def tearDown(self):
        Base.metadata.drop_all(bind=self.engine)
        app.dependency_overrides.clear()

    def test_list_events_and_filters(self):
        # Viewer tra cứu toàn bộ danh sách
        res = self.client.get(
            "/api/v1/events-calendar",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total"], 3)
        self.assertEqual(len(data["items"]), 3)

        # Lọc theo loại sự kiện
        res_type = self.client.get(
            "/api/v1/events-calendar?event_type=Sporting",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_type.status_code, 200)
        self.assertEqual(res_type.json()["total"], 1)
        self.assertEqual(res_type.json()["items"][0]["event_name"], "SuperBowl")

        # Lọc theo khoảng ngày
        res_date = self.client.get(
            "/api/v1/events-calendar?start_date=2016-02-10&end_date=2016-02-20",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_date.status_code, 200)
        self.assertEqual(res_date.json()["total"], 2)

        # Tìm kiếm theo tên
        res_search = self.client.get(
            "/api/v1/events-calendar?search=Valentines",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_search.status_code, 200)
        self.assertEqual(res_search.json()["total"], 1)

    def test_get_event_types(self):
        res = self.client.get(
            "/api/v1/events-calendar/types",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 200)
        types = res.json()
        self.assertIn("Sporting", types)
        self.assertIn("Cultural", types)
        self.assertIn("National", types)

    def test_get_event_by_id(self):
        res = self.client.get(
            "/api/v1/events-calendar/ev-01",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["event_name"], "SuperBowl")

        res_not_found = self.client.get(
            "/api/v1/events-calendar/non-existing-id",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_not_found.status_code, 404)

    def test_viewer_cannot_modify_events(self):
        # Viewer không có quyền tạo
        res_create = self.client.post(
            "/api/v1/events-calendar",
            json={"id": "ev-04", "event_name": "Easter", "event_date": "2016-03-27", "event_type": "Religious"},
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_create.status_code, 403)

        # Viewer không có quyền sửa
        res_update = self.client.put(
            "/api/v1/events-calendar/ev-01",
            json={"event_name": "SuperBowl 50"},
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_update.status_code, 403)

        # Viewer không có quyền xóa
        res_delete = self.client.delete(
            "/api/v1/events-calendar/ev-01",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_delete.status_code, 403)

    def test_admin_create_event(self):
        res = self.client.post(
            "/api/v1/events-calendar",
            json={"id": "ev-04", "event_name": "Easter", "event_date": "2016-03-27", "event_type": "Religious"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertEqual(data["id"], "ev-04")
        self.assertEqual(data["event_name"], "Easter")

        # Thử tạo trùng ID
        res_dup = self.client.post(
            "/api/v1/events-calendar",
            json={"id": "ev-04", "event_name": "Easter Duplicate", "event_date": "2016-03-27"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_dup.status_code, 400)

    def test_admin_update_event(self):
        res = self.client.put(
            "/api/v1/events-calendar/ev-01",
            json={"event_name": "SuperBowl 50 Championship", "event_type": "Sporting Special"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["event_name"], "SuperBowl 50 Championship")
        self.assertEqual(data["event_type"], "Sporting Special")

        res_not_found = self.client.put(
            "/api/v1/events-calendar/not-found",
            json={"event_name": "None"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_not_found.status_code, 404)

    def test_admin_delete_event(self):
        res = self.client.delete(
            "/api/v1/events-calendar/ev-01",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 204)

        # Kiểm tra sự kiện đã xóa
        check_res = self.client.get(
            "/api/v1/events-calendar/ev-01",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(check_res.status_code, 404)

        # Xóa lại phải trả về 404
        res_not_found = self.client.delete(
            "/api/v1/events-calendar/ev-01",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_not_found.status_code, 404)

    def test_admin_bulk_create_events(self):
        bulk_payload = {
            "items": [
                {"id": "bulk-01", "event_name": "Black Friday", "event_date": "2016-11-25", "event_type": "Promotion"},
                {"id": "bulk-02", "event_name": "Cyber Monday", "event_date": "2016-11-28", "event_type": "Promotion"},
            ]
        }
        res = self.client.post(
            "/api/v1/events-calendar/bulk",
            json=bulk_payload,
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["inserted"], 2)

        # Kiểm tra sự kiện mới đã xuất hiện
        res_check = self.client.get(
            "/api/v1/events-calendar?event_type=Promotion",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_check.status_code, 200)
        self.assertEqual(res_check.json()["total"], 2)


if __name__ == "__main__":
    unittest.main()
