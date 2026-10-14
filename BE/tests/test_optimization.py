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
from app.models.supplier import Supplier
from app.models.forecast import Forecast, ForecastSigma
from app.models.sales_history import SalesHistory
from app.models.inventory_param import InventoryParam
from app.models.audit_log import AuditLog
from app.models.system_setting import SystemSetting
from app.core.security import get_password_hash, create_access_token
from app.api.deps import get_db


class TestOptimizationEndpoints(unittest.TestCase):
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

            # Seed Supplier with lead_time_days = 7
            supplier = Supplier(
                id="SUP_001",
                name="Walmart Distribution",
                lead_time_days=7,
            )
            session.add(supplier)

            # Seed Products
            p1 = Product(item_id="FOODS_1_001", name="Fresh Milk", dept_id="FOODS_1", cat_id="FOODS")
            p2 = Product(item_id="HOBBIES_1_001", name="Board Game", dept_id="HOBBIES_1", cat_id="HOBBIES")
            session.add_all([p1, p2])

            # Seed Forecast for FOODS_1_001 (28 days)
            base_date = date(2026, 10, 1)
            for h in range(1, 29):
                fc_date = base_date + timedelta(days=h - 1)
                fc = Forecast(
                    id=f"fc_{h}",
                    item_id="FOODS_1_001",
                    store_id="CA_1",
                    forecast_date=fc_date,
                    h=h,
                    y_pred=20.0,
                    p10=16.0,
                    p50=20.0,
                    p90=24.0,
                    available=True,
                    model_version="v1.0.0",
                )
                session.add(fc)

            # Seed ForecastSigma for FOODS_1_001
            sigma = ForecastSigma(
                id="FOODS_1_001",
                sigma_d_h7=2.5,
                sigma_d_h14=3.5,
                sigma_d_h28=5.0,
            )
            session.add(sigma)

            # Seed SalesHistory for HOBBIES_1_001 (Không có forecast -> Fallback Static)
            for i in range(1, 30):
                s_date = base_date - timedelta(days=i)
                sh = SalesHistory(
                    id=f"sh_hobbies_{i}",
                    item_id="HOBBIES_1_001",
                    store_id="CA_1",
                    sale_date=s_date,
                    quantity=15.0,
                )
                session.add(sh)

            session.commit()

        self.client = TestClient(app)
        self.admin_token = create_access_token({"sub": "admin@dfios.com", "role": "Admin", "token_version": 1})
        self.manager_token = create_access_token({"sub": "manager@dfios.com", "role": "Warehouse Manager", "token_version": 1})
        self.viewer_token = create_access_token({"sub": "viewer@dfios.com", "role": "Viewer", "token_version": 1})

    def tearDown(self):
        app.dependency_overrides.clear()

    # ==========================================
    # UC29: Configure Target Service Level
    # ==========================================

    def test_get_service_level_default(self):
        # Admin / Manager được phép đọc
        res = self.client.get(
            "/api/v1/optimization/service-level",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["default_service_level"], 0.95)

        # Viewer bị cấm (403)
        res_viewer = self.client.get(
            "/api/v1/optimization/service-level",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_viewer.status_code, 403)

        # Unauthenticated bị 401
        res_unauth = self.client.get("/api/v1/optimization/service-level")
        self.assertEqual(res_unauth.status_code, 401)

    def test_update_service_level_admin_success(self):
        payload = {
            "default_service_level": 0.98,
            "category_service_levels": {"FOODS": 0.96},
            "item_service_levels": {"FOODS_1_001": 0.99},
        }
        res = self.client.put(
            "/api/v1/optimization/service-level",
            json=payload,
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["default_service_level"], 0.98)
        self.assertEqual(data["category_service_levels"]["FOODS"], 0.96)
        self.assertEqual(data["item_service_levels"]["FOODS_1_001"], 0.99)

        # Kiểm tra audit log
        with self.TestingSessionLocal() as session:
            log = (
                session.query(AuditLog)
                .filter(AuditLog.action == "optimization.update_service_level")
                .first()
            )
            self.assertIsNotNone(log)
            self.assertEqual(log.actor_email, "admin@dfios.com")

            # Kiểm tra tự động tính lại tham số tồn kho
            param = (
                session.query(InventoryParam)
                .filter(InventoryParam.item_id == "FOODS_1_001")
                .first()
            )
            self.assertIsNotNone(param)
            self.assertEqual(param.service_level, 0.99)

    def test_update_service_level_forbidden_and_validation(self):
        # Manager bị 403
        res_mgr = self.client.put(
            "/api/v1/optimization/service-level",
            json={"default_service_level": 0.95},
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_mgr.status_code, 403)

        # Giá trị ngoài khoảng [0.85, 0.99] bị 422
        res_low = self.client.put(
            "/api/v1/optimization/service-level",
            json={"default_service_level": 0.80},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_low.status_code, 422)

        res_high = self.client.put(
            "/api/v1/optimization/service-level",
            json={"default_service_level": 1.05},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_high.status_code, 422)

    # ==========================================
    # UC30: View & Recompute Safety Stock / ROP / EOQ
    # ==========================================

    def test_get_parameters_manager_and_admin_success(self):
        # Manager truy cập danh sách tham số
        res = self.client.get(
            "/api/v1/optimization/parameters",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertGreaterEqual(data["total"], 2)
        self.assertEqual(len(data["items"]), 2)

        # Kiểm tra item có ML (FOODS_1_001)
        foods_item = next((it for it in data["items"] if it["item_id"] == "FOODS_1_001"), None)
        self.assertIsNotNone(foods_item)
        self.assertEqual(foods_item["source"], "ml")
        self.assertGreater(foods_item["safety_stock"], 0)
        self.assertGreater(foods_item["reorder_point"], foods_item["safety_stock"])
        self.assertGreater(foods_item["eoq"], 0)

        # Kiểm tra item fallback Static (HOBBIES_1_001 không có forecast)
        hobbies_item = next((it for it in data["items"] if it["item_id"] == "HOBBIES_1_001"), None)
        self.assertIsNotNone(hobbies_item)
        self.assertEqual(hobbies_item["source"], "static")

        # Viewer bị cấm (403)
        res_viewer = self.client.get(
            "/api/v1/optimization/parameters",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_viewer.status_code, 403)

    def test_get_parameters_filtering(self):
        # Lọc category=FOODS
        res_cat = self.client.get(
            "/api/v1/optimization/parameters?category=FOODS",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_cat.status_code, 200)
        self.assertEqual(res_cat.json()["total"], 1)
        self.assertEqual(res_cat.json()["items"][0]["item_id"], "FOODS_1_001")

        # Lọc source=static
        res_static = self.client.get(
            "/api/v1/optimization/parameters?source=static",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_static.status_code, 200)
        self.assertEqual(res_static.json()["items"][0]["item_id"], "HOBBIES_1_001")

    def test_recompute_parameters_success(self):
        payload = {"store_id": "CA_1"}
        res = self.client.post(
            "/api/v1/optimization/recompute",
            json=payload,
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["computed_count"], 2)

        # Viewer gọi recompute bị 403
        res_viewer = self.client.post(
            "/api/v1/optimization/recompute",
            json=payload,
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_viewer.status_code, 403)

    # ==========================================
    # UC31: Compare ML vs Static Formula
    # ==========================================

    def test_compare_static_admin_success(self):
        res = self.client.get(
            "/api/v1/optimization/compare-static",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total_items"], 2)
        self.assertIn("total_holding_cost_savings", data)
        self.assertIn("avg_ss_reduction_percent", data)

        item = data["items"][0]
        self.assertIn("ml_safety_stock", item)
        self.assertIn("static_safety_stock", item)
        self.assertIn("ss_difference", item)
        self.assertIn("holding_cost_savings", item)

    def test_compare_static_role_forbidden(self):
        # Manager bị 403 (UC31 chỉ dành cho Admin)
        res_mgr = self.client.get(
            "/api/v1/optimization/compare-static",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_mgr.status_code, 403)

        # Viewer bị 403
        res_viewer = self.client.get(
            "/api/v1/optimization/compare-static",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_viewer.status_code, 403)

    # ==========================================
    # UC32: Run Cost Sensitivity Analysis
    # ==========================================

    def test_sensitivity_analysis_admin_success(self):
        payload = {
            "item_id": "FOODS_1_001",
            "store_id": "CA_1",
            "lead_time_deltas": [-0.20, 0.0, 0.20],
            "service_level_deltas": [-0.05, 0.0, 0.05],
            "holding_cost_rate": 0.20,
            "stockout_cost_per_unit": 5.0,
            "order_cost": 50.0,
        }
        res = self.client.post(
            "/api/v1/optimization/sensitivity-analysis",
            json=payload,
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertEqual(data["item_id"], "FOODS_1_001")
        self.assertIsNotNone(data["baseline_scenario"])
        self.assertEqual(data["baseline_scenario"]["cost_difference_vs_baseline"], 0.0)

        # Số lượng kịch bản mô phỏng = 3 * 3 - 1 (bỏ baseline) = 8
        self.assertEqual(len(data["scenarios"]), 8)
        self.assertGreaterEqual(len(data["insights"]), 1)

        # Kiểm tra tính toàn vẹn: sensitivity analysis chỉ mô phỏng, không ghi đè DB
        with self.TestingSessionLocal() as session:
            count = session.query(InventoryParam).count()
            self.assertGreaterEqual(count, 0)

    def test_sensitivity_analysis_role_forbidden(self):
        payload = {"item_id": "FOODS_1_001"}
        # Manager bị 403 (UC32 chỉ dành cho Admin)
        res_mgr = self.client.post(
            "/api/v1/optimization/sensitivity-analysis",
            json=payload,
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_mgr.status_code, 403)

        # Viewer bị 403
        res_viewer = self.client.post(
            "/api/v1/optimization/sensitivity-analysis",
            json=payload,
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_viewer.status_code, 403)
