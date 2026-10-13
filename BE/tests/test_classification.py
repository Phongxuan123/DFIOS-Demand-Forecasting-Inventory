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
from app.models.classification import SKUClassification
from app.core.security import get_password_hash, create_access_token
from app.api.deps import get_db


class TestClassificationEndpoints(unittest.TestCase):
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
                display_name="Viewer User",
                is_active=True,
                is_verified=True,
                token_version=1,
            )
            session.add_all([admin, manager, viewer])

            # Seed 5 products with different sales characteristics
            p1 = Product(item_id="SKU_HIGH_STABLE", name="Apple Premium", dept_id="FOODS_1", cat_id="FOODS")
            p2 = Product(item_id="SKU_HIGH_VOLATILE", name="Steak Wagyu", dept_id="FOODS_1", cat_id="FOODS")
            p3 = Product(item_id="SKU_MED_STABLE", name="Orange Juice", dept_id="FOODS_2", cat_id="FOODS")
            p4 = Product(item_id="SKU_LOW_STABLE", name="Toothpick", dept_id="HOUSE_1", cat_id="HOUSEHOLD")
            p5 = Product(item_id="SKU_LOW_VOLATILE", name="Antique Clock", dept_id="HOBBY_1", cat_id="HOBBIES")
            session.add_all([p1, p2, p3, p4, p5])

            base_date = date(2026, 10, 1)

            # SKU_HIGH_STABLE: Very high volume, very stable (CV low -> AX)
            for i in range(10):
                session.add(SalesHistory(id=f"s1_{i}", item_id="SKU_HIGH_STABLE", store_id="CA_1", sale_date=base_date + timedelta(days=i), quantity=100.0))

            # SKU_HIGH_VOLATILE: High volume, high variance (CV high -> AZ)
            for i in range(10):
                qty = 200.0 if i % 2 == 0 else 5.0
                session.add(SalesHistory(id=f"s2_{i}", item_id="SKU_HIGH_VOLATILE", store_id="CA_1", sale_date=base_date + timedelta(days=i), quantity=qty))

            # SKU_MED_STABLE: Medium volume, stable (BX)
            for i in range(10):
                session.add(SalesHistory(id=f"s3_{i}", item_id="SKU_MED_STABLE", store_id="CA_1", sale_date=base_date + timedelta(days=i), quantity=20.0))

            # SKU_LOW_STABLE: Low volume, stable (CX)
            for i in range(10):
                session.add(SalesHistory(id=f"s4_{i}", item_id="SKU_LOW_STABLE", store_id="CA_1", sale_date=base_date + timedelta(days=i), quantity=2.0))

            # SKU_LOW_VOLATILE: Low volume, volatile (CZ)
            for i in range(10):
                qty = 10.0 if i == 0 else 0.0
                session.add(SalesHistory(id=f"s5_{i}", item_id="SKU_LOW_VOLATILE", store_id="CA_1", sale_date=base_date + timedelta(days=i), quantity=qty))

            session.commit()

        self.client = TestClient(app)
        self.admin_token = create_access_token({"sub": "admin@dfios.com", "role": "Admin", "token_version": 1})
        self.manager_token = create_access_token({"sub": "manager@dfios.com", "role": "Warehouse Manager", "token_version": 1})
        self.viewer_token = create_access_token({"sub": "viewer@dfios.com", "role": "Viewer", "token_version": 1})

    def tearDown(self):
        app.dependency_overrides.clear()

    # --- UC25: Configure Thresholds & Recompute ---

    def test_get_thresholds_defaults(self):
        res = self.client.get(
            "/api/v1/classification/thresholds",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["a_cutoff"], 80.0)
        self.assertEqual(data["b_cutoff"], 95.0)
        self.assertEqual(data["cv_x"], 0.5)
        self.assertEqual(data["cv_y"], 1.0)

    def test_update_thresholds_role_permissions(self):
        payload = {
            "a_cutoff": 75.0,
            "b_cutoff": 90.0,
            "cv_x": 0.4,
            "cv_y": 0.8,
        }
        # Viewer -> 403 Forbidden
        res_v = self.client.put(
            "/api/v1/classification/thresholds",
            json=payload,
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_v.status_code, 403)

        # Manager -> 403 Forbidden (Admin only)
        res_m = self.client.put(
            "/api/v1/classification/thresholds",
            json=payload,
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_m.status_code, 403)

        # Admin -> 200 OK
        res_a = self.client.put(
            "/api/v1/classification/thresholds",
            json=payload,
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_a.status_code, 200)
        self.assertEqual(res_a.json()["a_cutoff"], 75.0)

        # Kiểm tra audit log
        with self.TestingSessionLocal() as session:
            log = session.query(AuditLog).filter(AuditLog.action == "classification.update_thresholds").first()
            self.assertIsNotNone(log)
            self.assertEqual(log.actor_email, "admin@dfios.com")

    def test_update_thresholds_invalid_values(self):
        # a_cutoff >= b_cutoff -> 422
        res = self.client.put(
            "/api/v1/classification/thresholds",
            json={
                "a_cutoff": 95.0,
                "b_cutoff": 90.0,
                "cv_x": 0.5,
                "cv_y": 1.0,
            },
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 422)

    def test_trigger_recompute_endpoint(self):
        # Viewer -> 403
        res_v = self.client.post(
            "/api/v1/classification/recompute",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_v.status_code, 403)

        # Manager -> 200 OK
        res_m = self.client.post(
            "/api/v1/classification/recompute",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_m.status_code, 200)
        data = res_m.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["total_skus_classified"], 5)

    # --- UC26: View ABC-XYZ Matrix ---

    def test_view_matrix(self):
        res = self.client.get(
            "/api/v1/classification/matrix",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total_skus"], 5)
        self.assertGreater(data["total_revenue"], 0)
        self.assertEqual(len(data["segments"]), 9)
        self.assertIn("AX", data["matrix"])
        self.assertIn("CZ", data["matrix"])

    # --- UC27: Filter SKUs by Segment ---

    def test_filter_skus(self):
        # Lọc segment cụ thể
        res = self.client.get(
            "/api/v1/classification/skus",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total"], 5)
        self.assertEqual(len(data["items"]), 5)

        # Lọc theo search
        res_search = self.client.get(
            "/api/v1/classification/skus?search=Apple",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_search.status_code, 200)
        self.assertEqual(res_search.json()["total"], 1)
        self.assertEqual(res_search.json()["items"][0]["item_id"], "SKU_HIGH_STABLE")

        # Lọc theo category
        res_cat = self.client.get(
            "/api/v1/classification/skus?category=HOUSEHOLD",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_cat.status_code, 200)
        self.assertEqual(res_cat.json()["total"], 1)

    # --- UC28: Recommendations ---

    def test_recommendations_role_access(self):
        # Viewer -> 403 Forbidden
        res_v = self.client.get(
            "/api/v1/classification/recommendations",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_v.status_code, 403)

        res_v_seg = self.client.get(
            "/api/v1/classification/recommendations/AX",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_v_seg.status_code, 403)

        # Manager -> 200 OK list all
        res_m = self.client.get(
            "/api/v1/classification/recommendations",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_m.status_code, 200)
        self.assertEqual(len(res_m.json()), 9)

        # Manager -> 200 OK single segment AX
        res_ax = self.client.get(
            "/api/v1/classification/recommendations/AX",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_ax.status_code, 200)
        data_ax = res_ax.json()
        self.assertEqual(data_ax["segment"], "AX")
        self.assertIn("Hàng ngày", data_ax["review_frequency"])
        self.assertEqual(data_ax["priority"], "Rất cao (Critical)")

        # Invalid segment -> 404
        res_inv = self.client.get(
            "/api/v1/classification/recommendations/XYZ",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_inv.status_code, 404)
