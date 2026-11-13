import unittest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.models.base import Base
from app.models.user import User
from app.models.model_registry import ModelRegistry
from app.models.audit_log import AuditLog
from app.core.security import get_password_hash, create_access_token
from app.api.deps import get_db


class TestModelRegistryEndpoints(unittest.TestCase):
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

    def test_unauthenticated_requests_fail(self):
        res_list = self.client.get("/api/v1/ml/models")
        self.assertEqual(res_list.status_code, 401)

        res_promote = self.client.post("/api/v1/ml/models/some-id/promote")
        self.assertEqual(res_promote.status_code, 401)

    def test_non_admin_cannot_promote(self):
        # Viewer / Manager gọi promote -> 403
        res_mgr = self.client.post(
            "/api/v1/ml/models/some-id/promote",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_mgr.status_code, 403)

        res_view = self.client.post(
            "/api/v1/ml/models/some-id/promote",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_view.status_code, 403)

    def test_register_and_list_models(self):
        req_payload = {
            "name": "LightGBM-M5-Core",
            "version": "v1.0.0",
            "algorithm": "lightgbm",
            "scope": "global",
            "is_production": False,
            "parameters": {"learning_rate": 0.05, "n_estimators": 100},
            "metrics": {"mae": 1.25, "rmse": 1.95, "mase": 0.85, "wrmsse": 0.78},
        }
        res_create = self.client.post(
            "/api/v1/ml/models",
            json=req_payload,
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_create.status_code, 201)
        created_data = res_create.json()
        model_id = created_data["id"]
        self.assertEqual(created_data["name"], "LightGBM-M5-Core")
        self.assertEqual(created_data["algorithm"], "lightgbm")

        # List models
        res_list = self.client.get(
            "/api/v1/ml/models",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_list.status_code, 200)
        list_data = res_list.json()
        self.assertEqual(list_data["total"], 1)
        self.assertEqual(list_data["items"][0]["id"], model_id)

    def test_promote_model_lifecycle_and_auto_demotion(self):
        # 1. Đăng ký model A
        res_a = self.client.post(
            "/api/v1/ml/models",
            json={
                "name": "LightGBM-Baseline",
                "version": "v1.0.0",
                "algorithm": "lightgbm",
                "scope": "global",
                "metrics": {"rmse": 2.10},
            },
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        id_a = res_a.json()["id"]

        # 2. Thăng hạng model A làm production
        res_promote_a = self.client.post(
            f"/api/v1/ml/models/{id_a}/promote",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_promote_a.status_code, 200)
        data_p_a = res_promote_a.json()
        self.assertTrue(data_p_a["promoted_model"]["is_production"])
        self.assertIsNotNone(data_p_a["promoted_model"]["promoted_at"])
        self.assertIsNone(data_p_a["demoted_model_id"])

        # 3. Đăng ký model B (vượt trội hơn)
        res_b = self.client.post(
            "/api/v1/ml/models",
            json={
                "name": "XGBoost-Enhanced",
                "version": "v2.0.0",
                "algorithm": "xgboost",
                "scope": "global",
                "metrics": {"rmse": 1.75},
            },
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        id_b = res_b.json()["id"]

        # 4. Thăng hạng model B -> model A phải tự động hạ cấp
        res_promote_b = self.client.post(
            f"/api/v1/ml/models/{id_b}/promote",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_promote_b.status_code, 200)
        data_p_b = res_promote_b.json()
        self.assertTrue(data_p_b["promoted_model"]["is_production"])
        self.assertEqual(data_p_b["demoted_model_id"], id_a)

        # 5. Kiểm tra lại trạng thái model A
        res_check_a = self.client.get(
            f"/api/v1/ml/models/{id_a}",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertFalse(res_check_a.json()["is_production"])

        # 6. Kiểm tra audit log
        with self.TestingSessionLocal() as session:
            logs = session.query(AuditLog).filter(AuditLog.action == "ml.model.promote").all()
            self.assertEqual(len(logs), 2)
            self.assertEqual(logs[1].actor_email, "admin@dfios.com")
            self.assertIn("XGBoost-Enhanced", logs[1].details)

    def test_promote_non_existent_model_returns_404(self):
        res = self.client.post(
            "/api/v1/ml/models/non-existent-uuid/promote",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 404)

    def test_filter_models_by_parameters(self):
        # Tạo 2 model khác nhau
        self.client.post(
            "/api/v1/ml/models",
            json={"name": "M1", "version": "1", "algorithm": "lightgbm", "scope": "global"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.client.post(
            "/api/v1/ml/models",
            json={"name": "M2", "version": "1", "algorithm": "xgboost", "scope": "FOODS_1"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )

        # Lọc theo algorithm=xgboost
        res_filter_algo = self.client.get(
            "/api/v1/ml/models?algorithm=xgboost",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_filter_algo.status_code, 200)
        self.assertEqual(res_filter_algo.json()["total"], 1)
        self.assertEqual(res_filter_algo.json()["items"][0]["name"], "M2")

        # Lọc theo scope=global
        res_filter_scope = self.client.get(
            "/api/v1/ml/models?scope=global",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_filter_scope.status_code, 200)
        self.assertEqual(res_filter_scope.json()["total"], 1)
        self.assertEqual(res_filter_scope.json()["items"][0]["name"], "M1")

    def test_validate_model_rbac(self):
        # Unauthenticated -> 401
        res_unauth = self.client.post("/api/v1/ml/models/m1/validate")
        self.assertEqual(res_unauth.status_code, 401)

        # Viewer / Manager -> 403
        res_viewer = self.client.post(
            "/api/v1/ml/models/m1/validate",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_viewer.status_code, 403)

        res_mgr = self.client.post(
            "/api/v1/ml/models/m1/validate",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_mgr.status_code, 403)

    def test_validate_model_not_found_returns_404(self):
        res = self.client.post(
            "/api/v1/ml/models/non-existent-id/validate",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 404)

    def test_validate_model_with_real_artifact_and_no_fake_constants(self):
        # 1. Đăng ký model TFT v1
        res_reg = self.client.post(
            "/api/v1/ml/models",
            json={
                "name": "TFT-Production",
                "version": "v1.0.0",
                "algorithm": "tft",
                "scope": "global",
                "parameters": {"hidden_size": 64},
                "metrics": {"wrmsse": 0.5004, "mae": 0.948},
            },
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_reg.status_code, 201)
        model_id = res_reg.json()["id"]

        # 2. Gọi validate
        res_val = self.client.post(
            f"/api/v1/ml/models/{model_id}/validate",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_val.status_code, 200)
        data = res_val.json()
        self.assertTrue(data["success"])
        self.assertTrue(data["validation_passed"])
        self.assertEqual(data["model_id"], model_id)
        # Trong DB rỗng test không có Product nào -> sample_skus_tested == 0, tuyệt đối không bịa 200
        self.assertEqual(data["sample_skus_tested"], 0)
        self.assertTrue(data["artifact_integrity"]["file_exists"])
        self.assertIsNotNone(data["artifact_integrity"]["sha256"])
        self.assertGreater(data["artifact_integrity"]["file_size_bytes"], 0)
        self.assertEqual(data["metrics"]["wrmsse"], 0.5004)

    def test_validate_model_with_missing_artifact_fails_authentically(self):
        # Đăng ký một model thuật toán lạ hoặc file không tồn tại
        res_reg = self.client.post(
            "/api/v1/ml/models",
            json={
                "name": "Nonexistent-Deep-Net",
                "version": "v9.9.9",
                "algorithm": "unknown_deep_net",
                "scope": "global",
            },
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_reg.status_code, 201)
        model_id = res_reg.json()["id"]

        # Gọi validate -> phải trả validation_passed = False và lý do thực tế
        res_val = self.client.post(
            f"/api/v1/ml/models/{model_id}/validate",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_val.status_code, 200)
        data = res_val.json()
        self.assertTrue(data["success"])
        self.assertFalse(data["validation_passed"])
        self.assertFalse(data["artifact_integrity"]["file_exists"])
        self.assertIn("KHÔNG đạt kiểm định", data["message"])

    def test_no_duplicate_model_registry_mounting(self):
        # UC48/N-24: Ensure model_registry_router is only mounted once under /ml prefix, avoiding duplicate operationIds
        schema = app.openapi()
        paths = schema.get("paths", {})
        # /api/v1/ml/models must exist
        self.assertIn("/api/v1/ml/models", paths)
        # /api/v1/models (unprefixed duplicate) must NOT exist
        self.assertNotIn("/api/v1/models", paths)


if __name__ == "__main__":
    unittest.main()
