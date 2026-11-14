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
from app.models.model_registry import ModelRegistry
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

    def test_get_stock_alerts_multi_store_global(self):
        # UC09/N-14: Test that global alerts return items across all stores (not forced to CA_1)
        with self.TestingSessionLocal() as session:
            inv_tx = Inventory(item_id="FOODS_1_001", store_id="TX_1", on_hand=0.0, on_order=0.0)
            param_tx = InventoryParam(
                id="param-tx-01",
                item_id="FOODS_1_001",
                store_id="TX_1",
                safety_stock=10.0,
                reorder_point=20.0,
                unit_price=10.0,
                eoq=30.0,
            )
            session.add_all([inv_tx, param_tx])
            session.commit()

        # 1. Global alerts without store_id
        resp_global = self.client.get(
            "/api/v1/dashboard/alerts",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp_global.status_code, 200)
        stores_in_global = {item["store_id"] for item in resp_global.json()["items"]}
        self.assertIn("CA_1", stores_in_global)
        self.assertIn("TX_1", stores_in_global)

        # 2. Global alerts with store_id=GLOBAL
        resp_explicit = self.client.get(
            "/api/v1/dashboard/alerts?store_id=GLOBAL",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp_explicit.status_code, 200)
        stores_explicit = {item["store_id"] for item in resp_explicit.json()["items"]}
        self.assertIn("CA_1", stores_explicit)
        self.assertIn("TX_1", stores_explicit)

        # 3. Filter strictly by TX_1
        resp_tx = self.client.get(
            "/api/v1/dashboard/alerts?store_id=TX_1",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp_tx.status_code, 200)
        items_tx = resp_tx.json()["items"]
        self.assertEqual(len(items_tx), 1)
        self.assertEqual(items_tx[0]["store_id"], "TX_1")

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

    def test_kpi_forecast_accuracy_authentic_metrics_and_no_fake_fallback(self):
        # UC07/N-16: When no production model exists, avg_forecast_accuracy is 'N/A' (no fake fallback)
        resp = self.client.get(
            "/api/v1/dashboard/kpis",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["avg_forecast_accuracy"], "N/A")

        # When a production model with wrmsse exists
        with self.TestingSessionLocal() as session:
            model = ModelRegistry(
                id="model-ensemble-test",
                name="Ensemble Production",
                version="v1.0",
                algorithm="ensemble",
                is_production=True,
                metrics={"wrmsse": 0.4935, "mase": 0.975},
            )
            session.add(model)
            session.commit()

        resp_with_model = self.client.get(
            "/api/v1/dashboard/kpis",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp_with_model.status_code, 200)
        self.assertEqual(resp_with_model.json()["avg_forecast_accuracy"], "WRMSSE 0.4935")

    def test_kpis_and_demand_trend_multi_store_global(self):
        # UC07/UC08/N-17: Test that global KPI & Demand Trend aggregate across all stores
        with self.TestingSessionLocal() as session:
            inv_tx = Inventory(item_id="FOODS_1_001", store_id="TX_1", on_hand=50.0, on_order=0.0)
            param_tx = InventoryParam(
                id="param-tx-02",
                item_id="FOODS_1_001",
                store_id="TX_1",
                safety_stock=10.0,
                reorder_point=20.0,
                unit_price=10.0,
                eoq=30.0,
            )
            rep_tx = ReplenishmentRecommendation(
                id="rec-tx-01",
                item_id="FOODS_1_001",
                store_id="TX_1",
                recommended_qty=30.0,
                final_qty=30.0,
                priority="HIGH",
                status="PENDING",
                reason="Stock <= ROP",
            )
            sale_tx = SalesHistory(
                id="sh-tx-01",
                item_id="FOODS_1_001",
                store_id="TX_1",
                sale_date=date.today() - timedelta(days=2),
                quantity=15.0,
            )
            session.add_all([inv_tx, param_tx, rep_tx, sale_tx])
            session.commit()

        # 1. Global KPIs (no store_id) - sums CA_1 (550.0) + TX_1 (500.0) = 1050.0
        resp_global_kpi = self.client.get(
            "/api/v1/dashboard/kpis",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp_global_kpi.status_code, 200)
        global_kpis = resp_global_kpi.json()
        self.assertEqual(global_kpis["total_inventory_value"], 1050.0)
        self.assertEqual(global_kpis["pending_replenishments_count"], 2)

        # 2. Specific store CA_1 KPIs - only CA_1 value 550.0 and 1 pending rec
        resp_ca_kpi = self.client.get(
            "/api/v1/dashboard/kpis?store_id=CA_1",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp_ca_kpi.status_code, 200)
        ca_kpis = resp_ca_kpi.json()
        self.assertEqual(ca_kpis["total_inventory_value"], 550.0)
        self.assertEqual(ca_kpis["pending_replenishments_count"], 1)

        # 3. Demand trend: global includes both stores
        resp_trend_global = self.client.get(
            "/api/v1/dashboard/demand-trend",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp_trend_global.status_code, 200)
        self.assertTrue(len(resp_trend_global.json()["data"]) > 0)

    def test_b21_and_b10_alert_enum_harmonization_and_deduplication(self):
        # UC10/B-21 & B-10: Harmonize alert enums and ensure cross-alias deduplication
        from app.repositories.dashboard_repository import dashboard_repository

        with self.TestingSessionLocal() as session:
            # 1. Seed alert with legacy type "CRITICAL_OUT_OF_STOCK"
            legacy_alert = Alert(
                id="alert-legacy-01",
                item_id="FOODS_1_001",
                store_id="CA_1",
                type="CRITICAL_OUT_OF_STOCK",
                message="Legacy out of stock alert",
                is_read=False,
            )
            session.add(legacy_alert)
            session.commit()

            # 2. find_or_create_alert with canonical "STOCK_CRITICAL" should deduplicate against legacy alias
            alert_obj, created = dashboard_repository.find_or_create_alert(
                session,
                item_id="FOODS_1_001",
                store_id="CA_1",
                alert_type="STOCK_CRITICAL",
                message="New alert message",
            )
            self.assertFalse(created)
            self.assertEqual(alert_obj.id, "alert-legacy-01")

            # 3. Test get_stock_alerts with limit=None (B-10: no truncation at 3500)
            items, summary, total = dashboard_repository.get_stock_alerts(
                session,
                store_id="CA_1",
                limit=None,
            )
            self.assertGreaterEqual(total, 1)
            self.assertEqual(len(items), total)

        # 4. API check-alerts should deduplicate against both aliases
        resp = self.client.post(
            "/api/v1/dashboard/check-alerts?store_id=CA_1",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("alerts_generated", data)
        self.assertIn("broadcast_count", data)

    def test_r20_demand_trend_model_version_isolation_and_kpi_dashboard_global(self):
        """
        R-20:
        1. Demand trend lọc chặt chẽ theo model_version production, loại trừ fast-inference / trùng lặp.
        2. KPI dashboard hỗ trợ store_id='GLOBAL' không bị ép cứng thành CA_1.
        """
        target_date = date.today() + timedelta(days=5)
        with self.TestingSessionLocal() as session:
            # Seed 2 forecast records for same item/store/date with different model versions
            fc_prod = Forecast(
                id=9101,
                item_id="FOODS_1_001",
                store_id="CA_1",
                forecast_date=target_date,
                h=5,
                y_pred=20.0,
                available=True,
                model_version="ensemble",
            )
            fc_fast = Forecast(
                id=9102,
                item_id="FOODS_1_001",
                store_id="CA_1",
                forecast_date=target_date,
                h=5,
                y_pred=35.0,
                available=True,
                model_version="fast-inference-sba",
            )
            session.add_all([fc_prod, fc_fast])
            session.commit()

        # Gọi demand-trend
        resp = self.client.get(
            "/api/v1/dashboard/demand-trend?store_id=CA_1",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()["data"]
        point = next((p for p in data if p["date"] == target_date.strftime("%Y-%m-%d")), None)
        self.assertIsNotNone(point)
        # Giá trị dự báo phải là 20.0 (từ production ensemble), KHÔNG phải bị cộng dồn 20 + 35 = 55.0
        self.assertEqual(point["predicted"], 20.0)

        # Gọi kpi-dashboard với store_id=GLOBAL
        resp_kpi_global = self.client.get(
            "/api/v1/dashboard/kpi-dashboard?store_id=GLOBAL",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(resp_kpi_global.status_code, 200)
        kpi_data = resp_kpi_global.json()
        self.assertEqual(kpi_data["store_id"], "GLOBAL")
        self.assertEqual(len(kpi_data["segment_availabilities"]), 9)


if __name__ == "__main__":
    unittest.main()
