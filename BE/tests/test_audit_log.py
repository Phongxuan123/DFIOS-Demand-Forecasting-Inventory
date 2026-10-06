import unittest
from datetime import datetime, timezone, timedelta
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


class TestAuditLogEndpoints(unittest.TestCase):
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
            # Tạo admin user
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
            # Tạo viewer user
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
            session.add_all([admin, viewer])

            # Thêm các bản ghi audit log mẫu
            now = datetime.now(timezone.utc)
            logs = [
                AuditLog(
                    id="log-1",
                    actor_email="admin@dfios.com",
                    action="admin.create_user",
                    ip_address="127.0.0.1",
                    details="Admin tạo tài khoản",
                    created_at=now - timedelta(hours=3),
                ),
                AuditLog(
                    id="log-2",
                    actor_email="admin@dfios.com",
                    action="auth.login",
                    ip_address="127.0.0.1",
                    details="Đăng nhập thành công",
                    created_at=now - timedelta(hours=2),
                ),
                AuditLog(
                    id="log-3",
                    actor_email="viewer@dfios.com",
                    action="auth.login",
                    ip_address="192.168.1.10",
                    details="Đăng nhập thành công",
                    created_at=now - timedelta(hours=1),
                ),
                AuditLog(
                    id="log-4",
                    actor_email="admin@dfios.com",
                    action="auth.reset_password",
                    ip_address="127.0.0.1",
                    details="Đổi mật khẩu thành công",
                    created_at=now,
                ),
            ]
            session.add_all(logs)
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

    def test_unauthenticated_access_denied(self):
        res = self.client.get("/api/v1/audit-logs")
        self.assertEqual(res.status_code, 401)

    def test_viewer_access_denied(self):
        res = self.client.get(
            "/api/v1/audit-logs",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 403)
        self.assertIn("Admin", res.json()["detail"])

    def test_admin_list_audit_logs_default(self):
        res = self.client.get(
            "/api/v1/audit-logs",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total"], 4)
        self.assertEqual(len(data["items"]), 4)
        # Sắp xếp mới nhất trước
        self.assertEqual(data["items"][0]["id"], "log-4")

    def test_admin_filter_by_action(self):
        res = self.client.get(
            "/api/v1/audit-logs?action=login",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total"], 2)
        for item in data["items"]:
            self.assertEqual(item["action"], "auth.login")

    def test_admin_filter_by_actor_email(self):
        res = self.client.get(
            "/api/v1/audit-logs?actor_email=viewer@dfios.com",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["actor_email"], "viewer@dfios.com")

    def test_admin_pagination(self):
        res = self.client.get(
            "/api/v1/audit-logs?skip=1&limit=2",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total"], 4)
        self.assertEqual(len(data["items"]), 2)
        self.assertEqual(data["skip"], 1)
        self.assertEqual(data["limit"], 2)

    def test_admin_get_distinct_actions(self):
        res = self.client.get(
            "/api/v1/audit-logs/actions",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        actions = res.json()
        self.assertIn("admin.create_user", actions)
        self.assertIn("auth.login", actions)
        self.assertIn("auth.reset_password", actions)
        self.assertEqual(len(actions), 3)


if __name__ == "__main__":
    unittest.main()
