import unittest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.models.base import Base
from app.models.user import User
from app.models.audit_log import AuditLog
from app.core.security import get_password_hash, create_access_token
from app.api.deps import get_db


class TestSystemSettingsEndpoints(unittest.TestCase):
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
            manager = User(
                id="manager-01",
                email="manager@dfios.com",
                password_hash=get_password_hash("Manager123"),
                role="Warehouse Manager",
                display_name="Warehouse Manager",
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
            session.add_all([admin, manager, viewer])
            session.commit()

        self.admin_token = create_access_token(
            data={"sub": "admin@dfios.com", "role": "Admin", "user_id": "admin-01", "token_version": 1}
        )
        self.manager_token = create_access_token(
            data={"sub": "manager@dfios.com", "role": "Warehouse Manager", "user_id": "manager-01", "token_version": 1}
        )
        self.viewer_token = create_access_token(
            data={"sub": "viewer@dfios.com", "role": "Viewer", "user_id": "viewer-01", "token_version": 1}
        )
        self.client = TestClient(app)

    def tearDown(self):
        Base.metadata.drop_all(bind=self.engine)
        app.dependency_overrides.clear()

    def test_unauthenticated_request_rejected(self):
        res = self.client.get("/api/v1/settings")
        self.assertEqual(res.status_code, 401)

        res_put = self.client.put("/api/v1/settings/timezone", json={"value": "UTC"})
        self.assertEqual(res_put.status_code, 401)

    def test_get_all_settings_default_values(self):
        # Viewer đọc được cấu hình
        res_viewer = self.client.get(
            "/api/v1/settings",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_viewer.status_code, 200)
        data = res_viewer.json()
        self.assertIn("settings", data)
        self.assertIn("settings_dict", data)
        settings_dict = data["settings_dict"]
        self.assertEqual(settings_dict["timezone"], "Asia/Ho_Chi_Minh")
        self.assertEqual(settings_dict["currency"], "USD")
        self.assertEqual(settings_dict["forecast_horizons"], [7, 14, 28])
        self.assertIn("critical_service_level", settings_dict["default_alert_thresholds"])

        # Manager đọc được cấu hình
        res_manager = self.client.get(
            "/api/v1/settings",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_manager.status_code, 200)

    def test_get_single_setting_by_key(self):
        res = self.client.get(
            "/api/v1/settings/currency",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["key"], "currency")
        self.assertEqual(data["value"], "USD")

        # Key không tồn tại
        res_404 = self.client.get(
            "/api/v1/settings/non_existent_param",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_404.status_code, 404)

    def test_non_admin_cannot_update_settings(self):
        # Viewer thử cập nhật -> 403
        res_viewer = self.client.put(
            "/api/v1/settings/timezone",
            json={"value": "UTC"},
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_viewer.status_code, 403)

        # Manager thử cập nhật -> 403
        res_manager = self.client.put(
            "/api/v1/settings/timezone",
            json={"value": "UTC"},
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_manager.status_code, 403)

    def test_admin_update_setting_and_audit_log(self):
        res = self.client.put(
            "/api/v1/settings/timezone",
            json={"value": "UTC", "description": "Múi giờ chuẩn quốc tế"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["value"], "UTC")

        # Kiểm tra đọc lại
        check_res = self.client.get(
            "/api/v1/settings/timezone",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(check_res.status_code, 200)
        self.assertEqual(check_res.json()["value"], "UTC")

        # Kiểm tra Audit Log
        with self.TestingSessionLocal() as session:
            logs = session.query(AuditLog).filter(AuditLog.action == "settings.update").all()
            self.assertEqual(len(logs), 1)
            self.assertEqual(logs[0].actor_email, "admin@dfios.com")
            self.assertIn("Asia/Ho_Chi_Minh", logs[0].details)
            self.assertIn("UTC", logs[0].details)

    def test_admin_update_forecast_horizons(self):
        res = self.client.put(
            "/api/v1/settings/forecast_horizons",
            json={"value": [7, 14, 21, 28]},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["value"], [7, 14, 21, 28])

    def test_validation_invalid_timezone(self):
        res = self.client.put(
            "/api/v1/settings/timezone",
            json={"value": "Invalid/Unknown_Zone"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 400)

    def test_validation_invalid_currency(self):
        res_empty = self.client.put(
            "/api/v1/settings/currency",
            json={"value": ""},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_empty.status_code, 400)

        res_type = self.client.put(
            "/api/v1/settings/currency",
            json={"value": 12345},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_type.status_code, 400)

    def test_validation_invalid_forecast_horizons(self):
        # Mảng rỗng
        res_empty = self.client.put(
            "/api/v1/settings/forecast_horizons",
            json={"value": []},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_empty.status_code, 400)

        # Số âm
        res_negative = self.client.put(
            "/api/v1/settings/forecast_horizons",
            json={"value": [-7, 14]},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_negative.status_code, 400)

        # Sai kiểu dữ liệu
        res_string = self.client.put(
            "/api/v1/settings/forecast_horizons",
            json={"value": ["7", "14"]},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_string.status_code, 400)

    def test_validation_invalid_alert_thresholds(self):
        # Service level ngoài khoảng cho phép [0.5, 1.0]
        res_csl = self.client.put(
            "/api/v1/settings/default_alert_thresholds",
            json={"value": {"critical_service_level": 1.5}},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_csl.status_code, 400)

        # lead_time_buffer_days âm
        res_ltb = self.client.put(
            "/api/v1/settings/default_alert_thresholds",
            json={"value": {"lead_time_buffer_days": -1}},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_ltb.status_code, 400)


if __name__ == "__main__":
    unittest.main()
