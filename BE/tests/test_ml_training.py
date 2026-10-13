import unittest
from datetime import date, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.models.base import Base
from app.models.user import User
from app.models.sales_history import SalesHistory
from app.models.event import Event
from app.models.audit_log import AuditLog
from app.core.security import get_password_hash, create_access_token
from app.api.deps import get_db
from app.services.ml_training_service import ml_training_service


class TestMLTrainingEndpoints(unittest.TestCase):
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
            evt = Event(
                id="evt-01",
                event_name="Super Bowl",
                event_date=date(2026, 1, 15),
                event_type="Sporting",
            )
            session.add_all([admin, manager, viewer, evt])

            # Thêm dữ liệu bán hàng lịch sử để train
            base_d = date(2026, 1, 1)
            for i in range(30):
                sale = SalesHistory(
                    id=f"sh_{i}",
                    item_id="FOODS_1_001",
                    store_id="CA_1",
                    sale_date=base_d + timedelta(days=i),
                    quantity=20.0 + (i % 5),
                )
                session.add(sale)
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
        res = self.client.post("/api/v1/ml/train", json={"models": ["lightgbm"]})
        self.assertEqual(res.status_code, 401)

        res_get = self.client.get("/api/v1/ml/train/some-job-id")
        self.assertEqual(res_get.status_code, 401)

    def test_non_admin_forbidden(self):
        res_mgr = self.client.post(
            "/api/v1/ml/train",
            json={"models": ["lightgbm"]},
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_mgr.status_code, 403)

        res_viewer = self.client.get(
            "/api/v1/ml/train",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_viewer.status_code, 403)

    def test_roadmap_models_rejected_clearly(self):
        for future_model in ["arima", "lstm", "tft"]:
            res = self.client.post(
                "/api/v1/ml/train",
                json={"models": [future_model]},
                headers={"Authorization": f"Bearer {self.admin_token}"},
            )
            self.assertEqual(res.status_code, 400)
            self.assertIn("lộ trình phát triển", res.json()["detail"])

    def test_invalid_model_name_rejected(self):
        res = self.client.post(
            "/api/v1/ml/train",
            json={"models": ["non_existent_neural_net"]},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("không hợp lệ", res.json()["detail"])

    def test_train_and_benchmark_lifecycle(self):
        # 1. Kích hoạt train job
        res = self.client.post(
            "/api/v1/ml/train",
            json={
                "models": ["lightgbm", "xgboost", "baseline_naive"],
                "horizon": 7,
                "item_ids": ["FOODS_1_001"],
            },
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 202)
        job_id = res.json()["job_id"]

        # 2. Poll trạng thái hoàn thành (Background task đã thực thi hoàn tất)
        poll_res = self.client.get(
            f"/api/v1/ml/train/{job_id}",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(poll_res.status_code, 200)
        job_data = poll_res.json()
        self.assertEqual(job_data["status"], "done")
        self.assertIsNotNone(job_data["best_model"])

        # 4. Kiểm tra metrics trả về đủ MAE, RMSE, MASE, WRMSSE
        metrics = job_data["metrics"]
        self.assertIn("lightgbm", metrics)
        self.assertIn("xgboost", metrics)
        self.assertIn("baseline_naive", metrics)

        for m_name in ["lightgbm", "xgboost", "baseline_naive"]:
            m_stats = metrics[m_name]
            self.assertIn("mae", m_stats)
            self.assertIn("rmse", m_stats)
            self.assertIn("mase", m_stats)
            self.assertIn("wrmsse", m_stats)
            self.assertGreaterEqual(m_stats["mae"], 0.0)
            self.assertGreaterEqual(m_stats["rmse"], 0.0)

        # 5. Kiểm tra audit log
        with self.TestingSessionLocal() as session:
            start_logs = session.query(AuditLog).filter(AuditLog.action == "ml.train.start").all()
            self.assertGreaterEqual(len(start_logs), 1)

            complete_logs = session.query(AuditLog).filter(AuditLog.action == "ml.train.complete").all()
            self.assertGreaterEqual(len(complete_logs), 1)

    def test_get_job_404(self):
        res = self.client.get(
            "/api/v1/ml/train/random-unknown-uuid",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 404)

    def test_list_jobs_pagination(self):
        # Tạo 1 job
        self.client.post(
            "/api/v1/ml/train",
            json={"models": ["baseline_naive"]},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )

        res = self.client.get(
            "/api/v1/ml/train?skip=0&limit=10",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("items", data)
        self.assertIn("total", data)
        self.assertGreaterEqual(data["total"], 1)


if __name__ == "__main__":
    unittest.main()
