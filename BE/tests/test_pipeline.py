import unittest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.models.base import Base
from app.models.inventory import Inventory
from app.models.inventory_param import InventoryParam
from app.models.product import Product
from app.models.supplier import Supplier
from app.models.user import User
from app.core.security import get_password_hash, create_access_token
from app.api.deps import get_db


class TestPipelineEndpoints(unittest.TestCase):
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
                display_name="Guest Viewer",
                is_active=True,
                is_verified=True,
                token_version=1,
            )
            session.add_all([admin, viewer])

            p1 = Product(item_id="FOODS_1_001", name="Fuji Apples", cat_id="FOODS", dept_id="FOODS_1")
            s1 = Supplier(id="SUP_01", name="Fresh Farms Co", lead_time_days=3, email="sup1@farms.com")
            inv1 = Inventory(item_id="FOODS_1_001", store_id="CA_1", on_hand=10.0, on_order=0.0)
            param1 = InventoryParam(
                id="param-01",
                item_id="FOODS_1_001",
                store_id="CA_1",
                safety_stock=15.0,
                reorder_point=35.0,
                unit_price=10.0,
                annual_demand=730.0,
                holding_cost=2.0,
                order_cost=50.0,
                eoq=50.0,
            )
            session.add_all([p1, s1, inv1, param1])
            session.commit()

        self.client = TestClient(app)
        self.admin_token = create_access_token({"sub": "admin@dfios.com", "token_version": 1})
        self.viewer_token = create_access_token({"sub": "viewer@dfios.com", "token_version": 1})

    def tearDown(self):
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=self.engine)

    # ---------------------------------------------------------
    # UC49: Schedule Automated Batch Forecast
    # ---------------------------------------------------------
    def test_create_and_list_batch_schedule(self):
        payload = {
            "name": "Weekly Monday Forecast Run",
            "cron_expression": "0 2 * * 1",
            "model_name": "lightgbm",
            "horizon": 28,
            "store_id": "CA_1",
            "auto_trigger_optimization": True,
        }
        resp = self.client.post(
            "/api/v1/ml/schedule",
            json=payload,
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        sched_id = data["id"]
        self.assertEqual(data["name"], "Weekly Monday Forecast Run")
        self.assertEqual(data["cron_expression"], "0 2 * * 1")

        # List schedules
        resp_list = self.client.get(
            "/api/v1/ml/schedule",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(resp_list.status_code, 200)
        self.assertGreaterEqual(resp_list.json()["total"], 2)

        # Delete schedule
        resp_del = self.client.delete(
            f"/api/v1/ml/schedule/{sched_id}",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(resp_del.status_code, 204)

    def test_batch_schedule_viewer_forbidden(self):
        resp = self.client.get(
            "/api/v1/ml/schedule",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp.status_code, 403)

    # ---------------------------------------------------------
    # UC50: Auto-compute SS/ROP/EOQ & ABC-XYZ after Forecast Run
    # ---------------------------------------------------------
    def test_trigger_pipeline_run_admin_success(self):
        payload = {
            "model_name": "lightgbm",
            "horizon": 28,
            "store_id": "CA_1",
        }
        resp = self.client.post(
            "/api/v1/ml/pipeline/trigger-run",
            json=payload,
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "COMPLETED")
        self.assertIn("run_id", data)
        self.assertGreaterEqual(data["forecasts_generated"], 28)
        self.assertGreaterEqual(data["inventory_params_updated"], 1)

    def test_trigger_pipeline_run_viewer_forbidden(self):
        payload = {"model_name": "lightgbm", "horizon": 28, "store_id": "CA_1"}
        resp = self.client.post(
            "/api/v1/ml/pipeline/trigger-run",
            json=payload,
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp.status_code, 403)


if __name__ == "__main__":
    unittest.main()
