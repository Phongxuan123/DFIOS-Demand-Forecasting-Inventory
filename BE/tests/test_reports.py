import unittest
from datetime import date, datetime, timedelta, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.models.base import Base
from app.models.classification import SKUClassification
from app.models.forecast import Forecast
from app.models.inventory import Inventory
from app.models.inventory_param import InventoryParam
from app.models.product import Product
from app.models.sales_history import SalesHistory
from app.models.user import User
from app.core.security import get_password_hash, create_access_token
from app.api.deps import get_db


class TestReportsEndpoints(unittest.TestCase):
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
                display_name="Guest Viewer",
                is_active=True,
                is_verified=True,
                token_version=1,
            )
            session.add_all([admin, manager, viewer])

            # Products
            p1 = Product(item_id="FOODS_1_001", name="Fuji Apples", cat_id="FOODS", dept_id="FOODS_1")
            p2 = Product(item_id="FOODS_1_002", name="Whole Milk", cat_id="FOODS", dept_id="FOODS_1")
            session.add_all([p1, p2])

            # Inventory & Params
            inv1 = Inventory(item_id="FOODS_1_001", store_id="CA_1", on_hand=15.0, on_order=10.0)
            param1 = InventoryParam(
                id="param-01",
                item_id="FOODS_1_001",
                store_id="CA_1",
                safety_stock=10.0,
                reorder_point=25.0,
                unit_price=10.0,
                annual_demand=730.0,
                holding_cost=2.0,
                order_cost=50.0,
                eoq=60.0,
                source="ml",
            )
            session.add_all([inv1, param1])

            # SKU Classification
            c1 = SKUClassification(
                id="cls-01",
                item_id="FOODS_1_001",
                abc_class="A",
                xyz_class="X",
                segment="AX",
                revenue=7300.0,
                revenue_share=85.0,
                cv=0.15,
            )
            session.add(c1)

            # Sales & Forecasts
            today = date.today()
            s1 = SalesHistory(
                id="sh-01",
                item_id="FOODS_1_001",
                store_id="CA_1",
                sale_date=today - timedelta(days=1),
                quantity=20.0,
            )
            f1 = Forecast(
                id="fc-01",
                item_id="FOODS_1_001",
                store_id="CA_1",
                forecast_date=today - timedelta(days=1),
                h=1,
                y_pred=22.0,
                available=True,
                model_version="v1.0.0",
            )
            session.add_all([s1, f1])

            session.commit()

        self.client = TestClient(app)
        self.admin_token = create_access_token({"sub": "admin@dfios.com", "token_version": 1})
        self.manager_token = create_access_token({"sub": "manager@dfios.com", "token_version": 1})
        self.viewer_token = create_access_token({"sub": "viewer@dfios.com", "token_version": 1})

    def tearDown(self):
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=self.engine)

    # ---------------------------------------------------------
    # UC39: Forecast Accuracy Report
    # ---------------------------------------------------------
    def test_get_forecast_accuracy_report(self):
        resp = self.client.get(
            "/api/v1/reports/forecast-accuracy?model_name=lightgbm",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["model_name"], "lightgbm")
        self.assertIn("overall_metrics", data)
        self.assertIn("abc_breakdown", data)
        self.assertGreater(data["overall_metrics"]["sample_count"], 0)

    def test_get_forecast_accuracy_abc_filter(self):
        resp = self.client.get(
            "/api/v1/reports/forecast-accuracy?abc_class=A",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("A", data["abc_breakdown"])

    # ---------------------------------------------------------
    # UC40: Inventory Performance Report
    # ---------------------------------------------------------
    def test_get_inventory_performance_report(self):
        resp = self.client.get(
            "/api/v1/reports/inventory-performance?store_id=CA_1",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("total_inventory_value", data)
        self.assertIn("average_turnover_ratio", data)
        self.assertIn("average_days_of_supply", data)
        self.assertGreaterEqual(len(data["items"]), 1)

    # ---------------------------------------------------------
    # UC41: Historical Backtesting
    # ---------------------------------------------------------
    def test_run_backtesting_admin_success(self):
        payload = {
            "model_name": "lightgbm",
            "backtest_days": 28,
            "store_id": "CA_1",
            "target_service_level": 0.95,
        }
        resp = self.client.post(
            "/api/v1/reports/backtesting",
            json=payload,
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["simulated_days"], 28)
        self.assertGreater(data["stockout_reduction_pct"], 0)
        self.assertGreater(data["service_level_achieved"], 90.0)

    def test_run_backtesting_viewer_forbidden(self):
        payload = {"model_name": "lightgbm", "backtest_days": 28, "store_id": "CA_1"}
        resp = self.client.post(
            "/api/v1/reports/backtesting",
            json=payload,
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp.status_code, 403)

    # ---------------------------------------------------------
    # UC42: Cost Comparison Report
    # ---------------------------------------------------------
    def test_get_cost_comparison_admin_success(self):
        resp = self.client.get(
            "/api/v1/reports/cost-comparison?store_id=CA_1",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("baseline_policy", data)
        self.assertIn("ml_policy", data)
        self.assertGreater(data["cost_savings_amount"], 0)
        self.assertGreater(data["savings_percentage"], 0)

    def test_get_cost_comparison_viewer_forbidden(self):
        resp = self.client.get(
            "/api/v1/reports/cost-comparison",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp.status_code, 403)

    # ---------------------------------------------------------
    # UC43: Export Report CSV
    # ---------------------------------------------------------
    def test_export_report_csv_success(self):
        resp = self.client.get(
            "/api/v1/reports/export?report_type=forecast-accuracy&store_id=CA_1",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/csv", resp.headers["content-type"])
        self.assertIn("attachment; filename=", resp.headers["content-disposition"])
        self.assertIn("MAE", resp.text)

    def test_export_report_invalid_type(self):
        resp = self.client.get(
            "/api/v1/reports/export?report_type=non-existent",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp.status_code, 400)


if __name__ == "__main__":
    unittest.main()
