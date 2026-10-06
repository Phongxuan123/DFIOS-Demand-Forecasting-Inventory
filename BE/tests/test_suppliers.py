import unittest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.models.base import Base
from app.models.user import User
from app.models.supplier import Supplier
from app.core.security import get_password_hash, create_access_token
from app.api.deps import get_db


class TestSupplierMasterEndpoints(unittest.TestCase):
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
            sup1 = Supplier(id="SUP_A", name="Supplier Alpha", lead_time_days=5)
            sup2 = Supplier(id="SUP_B", name="Supplier Beta", lead_time_days=10)
            session.add_all([admin, viewer, sup1, sup2])
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

    def test_list_and_get_suppliers(self):
        # Viewer có thể đọc danh sách
        res = self.client.get(
            "/api/v1/suppliers",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total"], 2)

        # Xem chi tiết
        res_detail = self.client.get(
            "/api/v1/suppliers/SUP_A",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_detail.status_code, 200)
        self.assertEqual(res_detail.json()["lead_time_days"], 5)

    def test_viewer_cannot_modify_suppliers(self):
        res = self.client.post(
            "/api/v1/suppliers",
            json={"name": "New Supplier", "lead_time_days": 7},
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 403)

    def test_admin_crud_supplier(self):
        # 1. Tạo NCC mới
        create_res = self.client.post(
            "/api/v1/suppliers",
            json={"id": "SUP_C", "name": "Supplier Gamma", "lead_time_days": 14},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(create_res.status_code, 201)
        self.assertEqual(create_res.json()["name"], "Supplier Gamma")

        # 2. Cập nhật Lead Time
        update_res = self.client.put(
            "/api/v1/suppliers/SUP_C",
            json={"lead_time_days": 12},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(update_res.status_code, 200)
        self.assertEqual(update_res.json()["lead_time_days"], 12)

        # 3. Xóa NCC
        del_res = self.client.delete(
            "/api/v1/suppliers/SUP_C",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(del_res.status_code, 204)


if __name__ == "__main__":
    unittest.main()
