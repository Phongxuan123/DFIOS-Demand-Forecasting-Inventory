import unittest
from datetime import date, datetime, timedelta, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.models.base import Base
from app.models.alert import Alert
from app.models.forecast import Forecast
from app.models.inventory import Inventory
from app.models.inventory_param import InventoryParam
from app.models.product import Product
from app.models.replenishment import ReplenishmentRecommendation
from app.models.sales_history import SalesHistory
from app.models.supplier import Supplier
from app.models.user import User
from app.core.security import get_password_hash, create_access_token
from app.api.deps import get_db


class TestDashboardEndpoints(unittest.TestCase):
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
            # 1. Người dùng kiểm thử
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

            # 2. Sản phẩm
            p1 = Product(item_id="FOODS_1_001", name="Fuji Apples", cat_id="FOODS", dept_id="FOODS_1")
            p2 = Product(item_id="FOODS_1_002", name="Whole Milk", cat_id="FOODS", dept_id="FOODS_1")
            p3 = Product(item_id="HOUSEHOLD_1_001", name="Cotton Towels", cat_id="HOUSEHOLD", dept_id="HOUSEHOLD_1")
            session.add_all([p1, p2, p3])

            # 3. Nhà cung cấp
            s1 = Supplier(id="SUP_01", name="Fresh Farms Co", lead_time_days=3, email="sup1@farms.com")
            s2 = Supplier(id="SUP_02", name="Home Essentials", lead_time_days=7, email="sup2@essentials.com")
            session.add_all([s1, s2])

            # 4. Tồn kho & Tham số
            # FOODS_1_001: on_hand 5 <= SS 15 -> CRITICAL
            inv1 = Inventory(item_id="FOODS_1_001", store_id="CA_1", on_hand=5.0, on_order=0.0)
            param1 = InventoryParam(
                id="param-01",
                item_id="FOODS_1_001",
                store_id="CA_1",
                safety_stock=15.0,
                reorder_point=35.0,
                unit_price=10.0,
                eoq=50.0,
            )

            # FOODS_1_002: on_hand 0 <= SS 10 -> CRITICAL (Stockout)
            inv2 = Inventory(item_id="FOODS_1_002", store_id="CA_1", on_hand=0.0, on_order=20.0)
            param2 = InventoryParam(
                id="param-02",
                item_id="FOODS_1_002",
                store_id="CA_1",
                safety_stock=10.0,
                reorder_point=25.0,
                unit_price=20.0,
                eoq=40.0,
            )

            # HOUSEHOLD_1_001: on_hand 100 > ROP 30 -> HEALTHY
            inv3 = Inventory(item_id="HOUSEHOLD_1_001", store_id="CA_1", on_hand=100.0, on_order=50.0)
            param3 = InventoryParam(
                id="param-03",
                item_id="HOUSEHOLD_1_001",
                store_id="CA_1",
                safety_stock=10.0,
                reorder_point=30.0,
                unit_price=5.0,
                eoq=80.0,
            )
            session.add_all([inv1, inv2, inv3, param1, param2, param3])

            # 5. Đề xuất đặt hàng đang chờ duyệt
            rep1 = ReplenishmentRecommendation(
                id="rec-01",
                item_id="FOODS_1_001",
                store_id="CA_1",
                recommended_qty=50.0,
                final_qty=50.0,
                priority="HIGH",
                status="PENDING",
                reason="Stock <= ROP",
            )
            session.add(rep1)

            # 6. Lịch sử bán hàng
            today = date.today()
            sales1 = SalesHistory(
                id="sh-01",
                item_id="FOODS_1_001",
                store_id="CA_1",
                sale_date=today - timedelta(days=2),
                quantity=12.0,
            )
            sales2 = SalesHistory(
                id="sh-02",
                item_id="FOODS_1_001",
                store_id="CA_1",
                sale_date=today - timedelta(days=1),
                quantity=18.0,
            )
            session.add_all([sales1, sales2])

            # 7. Dự báo nhu cầu
            fc1 = Forecast(
                id="fc-01",
                item_id="FOODS_1_001",
                store_id="CA_1",
                forecast_date=today + timedelta(days=1),
                h=1,
                y_pred=20.0,
                p10=12.0,
                p50=20.0,
                p90=28.0,
                available=True,
                model_version="v1.0.0",
            )
            session.add(fc1)

            session.commit()

        self.client = TestClient(app)
        self.admin_token = create_access_token({"sub": "admin@dfios.com", "token_version": 1})
        self.manager_token = create_access_token({"sub": "manager@dfios.com", "token_version": 1})
        self.viewer_token = create_access_token({"sub": "viewer@dfios.com", "token_version": 1})

    def tearDown(self):
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=self.engine)

    # ---------------------------------------------------------
    # UC07: Executive Dashboard KPIs
    # ---------------------------------------------------------
    def test_get_executive_kpis_success(self):
        resp = self.client.get(
            "/api/v1/dashboard/kpis",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        self.assertEqual(data["total_skus"], 3)
        self.assertEqual(data["total_suppliers"], 2)
        # Total value: (5 * 10) + (0 * 20) + (100 * 5) = 550.0
        self.assertEqual(data["total_inventory_value"], 550.0)
        # Stockout rate: 1 out of 3 = 33.33%
        self.assertAlmostEqual(data["stockout_rate"], 33.33, places=1)
        self.assertEqual(data["pending_replenishments_count"], 1)
        self.assertGreaterEqual(data["reorder_alerts_count"], 2)

    def test_get_executive_kpis_store_filter(self):
        resp = self.client.get(
            "/api/v1/dashboard/kpis?store_id=CA_1",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["total_inventory_value"], 550.0)

        # Non-existent store
        resp_empty = self.client.get(
            "/api/v1/dashboard/kpis?store_id=TX_99",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(resp_empty.status_code, 200)
        data_empty = resp_empty.json()
        self.assertEqual(data_empty["total_inventory_value"], 0.0)
        self.assertEqual(data_empty["stockout_rate"], 0.0)

    # ---------------------------------------------------------
    # UC08: Demand Trend Chart
    # ---------------------------------------------------------
    def test_get_demand_trend_success(self):
        resp = self.client.get(
            "/api/v1/dashboard/demand-trend?days=14",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("data", data)
        self.assertIsInstance(data["data"], list)
        self.assertGreater(len(data["data"]), 0)

        # Check structure of a trend point
        first_point = data["data"][0]
        self.assertIn("date", first_point)
        self.assertIn("actual", first_point)
        self.assertIn("predicted", first_point)

    def test_get_demand_trend_category_filter(self):
        resp = self.client.get(
            "/api/v1/dashboard/demand-trend?category=FOODS&days=7",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["category"], "FOODS")

    # ---------------------------------------------------------
    # UC09: Stockout / Threshold Alert Panel
    # ---------------------------------------------------------
    def test_get_stock_alerts_traffic_light(self):
        resp = self.client.get(
            "/api/v1/dashboard/alerts",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        self.assertIn("summary", data)
        summary = data["summary"]
        self.assertEqual(summary["total_monitored"], 3)
        self.assertEqual(summary["critical_count"], 2)
        self.assertEqual(summary["healthy_count"], 1)

        items = data["items"]
        self.assertEqual(len(items), 3)

        # CRITICAL items should be at the top
        self.assertEqual(items[0]["severity"], "CRITICAL")
        self.assertEqual(items[1]["severity"], "CRITICAL")
        self.assertEqual(items[2]["severity"], "HEALTHY")

    def test_get_stock_alerts_filter_by_severity(self):
        resp = self.client.get(
            "/api/v1/dashboard/alerts?severity=CRITICAL",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["total"], 2)
        for item in data["items"]:
            self.assertEqual(item["severity"], "CRITICAL")

    # ---------------------------------------------------------
    # UC10: Real-time Stock Alert
    # ---------------------------------------------------------
    def test_check_realtime_alerts_manager_success(self):
        resp = self.client.post(
            "/api/v1/dashboard/check-alerts?store_id=CA_1",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        # Should have generated alerts for the 2 critical items
        self.assertEqual(data["alerts_generated"], 2)
        self.assertEqual(data["broadcast_count"], 2)

        # Second check: deduplication ensures no duplicate unread alerts
        resp_again = self.client.post(
            "/api/v1/dashboard/check-alerts?store_id=CA_1",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(resp_again.status_code, 200)
        data_again = resp_again.json()
        self.assertEqual(data_again["alerts_generated"], 0)

    def test_check_realtime_alerts_viewer_forbidden(self):
        resp = self.client.post(
            "/api/v1/dashboard/check-alerts",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp.status_code, 403)

    # ---------------------------------------------------------
    # Aggregated Overview Endpoint
    # ---------------------------------------------------------
    def test_get_dashboard_overview_success(self):
        resp = self.client.get(
            "/api/v1/dashboard/overview",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        self.assertIn("kpis", data)
        self.assertIn("charts", data)
        self.assertIn("recent_alerts", data)

        kpis = data["kpis"]
        self.assertEqual(kpis["totalSkus"], 3)
        self.assertEqual(kpis["totalSuppliers"], 2)

        charts = data["charts"]
        self.assertIn("forecastTrend", charts)
        self.assertIn("inventoryHealth", charts)
        self.assertIn("urgency", charts)

    def test_unauthenticated_request_fails(self):
        resp = self.client.get("/api/v1/dashboard/kpis")
        self.assertEqual(resp.status_code, 401)


if __name__ == "__main__":
    unittest.main()
