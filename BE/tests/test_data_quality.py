import unittest
from datetime import date, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.models.base import Base
from app.models.user import User
from app.models.product import Product
from app.models.sales_history import SalesHistory
from app.models.audit_log import AuditLog
from app.core.security import get_password_hash, create_access_token
from app.api.deps import get_db


class TestDataQualityEndpoints(unittest.TestCase):
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
            prod = Product(
                item_id="FOODS_1_001",
                name="Healthy Granola Cereal",
                dept_id="FOODS_1",
                cat_id="FOODS",
            )
            session.add_all([admin, manager, viewer, prod])
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

    def test_unauthenticated_requests_fail(self):
        res = self.client.post("/api/v1/ml/data-quality/run", json={})
        self.assertEqual(res.status_code, 401)

        res_get = self.client.get("/api/v1/ml/data-quality/some-id")
        self.assertEqual(res_get.status_code, 401)

    def test_non_admin_forbidden(self):
        res_mgr = self.client.post(
            "/api/v1/ml/data-quality/run",
            json={},
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_mgr.status_code, 403)

        res_viewer = self.client.get(
            "/api/v1/ml/data-quality",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_viewer.status_code, 403)

    def test_empty_sales_data_triggers_failure(self):
        res = self.client.post(
            "/api/v1/ml/data-quality/run",
            json={},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertFalse(data["passed"])
        self.assertEqual(data["status"], "FAILED")
        self.assertEqual(data["summary"]["total_records"], 0)
        self.assertTrue(any(i["check_type"] == "EMPTY_DATA" for i in data["issues"]))

    def test_clean_sales_data_passes(self):
        base_date = date(2026, 1, 1)
        with self.TestingSessionLocal() as session:
            for i in range(10):
                sale = SalesHistory(
                    id=f"rec_{i}",
                    item_id="FOODS_1_001",
                    store_id="CA_1",
                    sale_date=base_date + timedelta(days=i),
                    quantity=10.0 + (i % 3),
                )
                session.add(sale)
            session.commit()

        res = self.client.post(
            "/api/v1/ml/data-quality/run",
            json={"item_ids": ["FOODS_1_001"], "store_id": "CA_1"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertTrue(data["passed"])
        self.assertEqual(data["status"], "PASSED")
        self.assertEqual(data["summary"]["total_records"], 10)
        self.assertEqual(data["summary"]["negative_values_count"], 0)
        self.assertEqual(data["summary"]["invalid_sku_count"], 0)
        self.assertFalse(data["summary"]["leakage_detected"])

    def test_negative_quantity_and_invalid_sku_detected(self):
        with self.TestingSessionLocal() as session:
            s1 = SalesHistory(
                id="rec_neg",
                item_id="FOODS_1_001",
                store_id="CA_1",
                sale_date=date(2026, 1, 1),
                quantity=-5.0,
            )
            s2 = SalesHistory(
                id="rec_bad_sku",
                item_id="UNKNOWN_999",
                store_id="CA_1",
                sale_date=date(2026, 1, 2),
                quantity=10.0,
            )
            session.add_all([s1, s2])
            session.commit()

        res = self.client.post(
            "/api/v1/ml/data-quality/run",
            json={},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertFalse(data["passed"])
        self.assertEqual(data["status"], "FAILED")
        self.assertEqual(data["summary"]["negative_values_count"], 1)
        self.assertEqual(data["summary"]["invalid_sku_count"], 1)
        check_types = [i["check_type"] for i in data["issues"]]
        self.assertIn("NEGATIVE_VALUE", check_types)
        self.assertIn("UNKNOWN_SKU", check_types)

    def test_data_leakage_detected_when_post_cutoff(self):
        base_date = date(2026, 2, 1)
        with self.TestingSessionLocal() as session:
            for i in range(5):
                sale = SalesHistory(
                    id=f"rec_leak_{i}",
                    item_id="FOODS_1_001",
                    store_id="CA_1",
                    sale_date=base_date + timedelta(days=i),
                    quantity=12.0,
                )
                session.add(sale)
            session.commit()

        # Cutoff đặt ở ngày 2026-02-02 (ngày 3, 4, 5 sẽ bị coi là rò rỉ)
        res = self.client.post(
            "/api/v1/ml/data-quality/run",
            json={"cutoff_date": "2026-02-02"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertFalse(data["passed"])
        self.assertEqual(data["status"], "FAILED")
        self.assertTrue(data["summary"]["leakage_detected"])
        leak_issues = [i for i in data["issues"] if i["check_type"] == "DATA_LEAKAGE"]
        self.assertGreaterEqual(len(leak_issues), 1)

    def test_duplicate_dates_and_outliers(self):
        base_date = date(2026, 3, 1)
        with self.TestingSessionLocal() as session:
            # 6 ngày thông thường
            for i in range(6):
                sale = SalesHistory(
                    id=f"rec_norm_{i}",
                    item_id="FOODS_1_001",
                    store_id="CA_1",
                    sale_date=base_date + timedelta(days=i),
                    quantity=10.0,
                )
                session.add(sale)
            # Trùng lặp ngày 2026-03-01
            dup = SalesHistory(
                id="rec_dup",
                item_id="FOODS_1_001",
                store_id="CA_1",
                sale_date=base_date,
                quantity=11.0,
            )
            # Ngoại lai cực lớn
            outlier = SalesHistory(
                id="rec_outlier",
                item_id="FOODS_1_001",
                store_id="CA_1",
                sale_date=base_date + timedelta(days=7),
                quantity=500.0,
            )
            session.add_all([dup, outlier])
            session.commit()

        res = self.client.post(
            "/api/v1/ml/data-quality/run",
            json={"outlier_threshold_std": 2.5},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertGreater(data["summary"]["duplicate_dates_count"], 0)
        self.assertGreater(data["summary"]["outliers_count"], 0)

    def test_get_run_by_id_and_audit_log(self):
        # 1. Chạy run
        create_res = self.client.post(
            "/api/v1/ml/data-quality/run",
            json={},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        run_id = create_res.json()["id"]

        # 2. Lấy chi tiết bằng run_id
        get_res = self.client.get(
            f"/api/v1/ml/data-quality/{run_id}",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(get_res.status_code, 200)
        self.assertEqual(get_res.json()["id"], run_id)

        # 3. ID không tồn tại -> 404
        get_404 = self.client.get(
            "/api/v1/ml/data-quality/non-existent-run-id",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(get_404.status_code, 404)

        # 4. Danh sách runs
        list_res = self.client.get(
            "/api/v1/ml/data-quality",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(list_res.status_code, 200)
        self.assertGreaterEqual(list_res.json()["total"], 1)

        # 5. Kiểm tra audit log
        with self.TestingSessionLocal() as session:
            logs = session.query(AuditLog).filter(AuditLog.action == "ml.data_quality.run").all()
            self.assertGreaterEqual(len(logs), 1)
            self.assertEqual(logs[0].actor_email, "admin@dfios.com")


if __name__ == "__main__":
    unittest.main()
