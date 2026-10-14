import unittest
from datetime import date, datetime, timedelta, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.models.base import Base
from app.models.user import User
from app.models.product import Product
from app.models.forecast import Forecast, ForecastSigma, ForecastOverride, ForecastExplanation
from app.models.sales_history import SalesHistory
from app.models.audit_log import AuditLog
from app.core.security import get_password_hash, create_access_token
from app.api.deps import get_db


class TestForecastEndpoints(unittest.TestCase):
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

            # Seed Products
            p1 = Product(item_id="FOODS_1_001", name="Super Apple", dept_id="FOODS_1", cat_id="FOODS")
            p2 = Product(item_id="HOBBIES_1_001", name="Board Game", dept_id="HOBBIES_1", cat_id="HOBBIES")
            p3 = Product(item_id="FOODS_1_002", name="Super Banana", dept_id="FOODS_1", cat_id="FOODS")
            session.add_all([p1, p2, p3])

            # Seed Forecasts (28 days for FOODS_1_001)
            base_date = date(2026, 10, 1)
            for h in range(1, 29):
                fc_date = base_date + timedelta(days=h - 1)
                fc = Forecast(
                    id=f"fc_{h}",
                    item_id="FOODS_1_001",
                    store_id="CA_1",
                    forecast_date=fc_date,
                    h=h,
                    y_pred=10.0 + h,
                    p10=8.0 + h,
                    p50=10.0 + h,
                    p90=12.0 + h,
                    available=True,
                    model_version="v1.0.0",
                )
                session.add(fc)


            # Seed SalesHistory for FOODS_1_001 (overlapping 14 days)
            for i in range(1, 15):
                s_date = base_date + timedelta(days=i - 1)
                sh = SalesHistory(
                    id=f"sh_{i}",
                    item_id="FOODS_1_001",
                    store_id="CA_1",
                    sale_date=s_date,
                    quantity=9.0 + i,  # slight error vs predicted
                )
                session.add(sh)

            # Seed Sigma
            sigma = ForecastSigma(
                id="FOODS_1_001",
                sigma_d_h7=1.5,
                sigma_d_h14=2.3,
                sigma_d_h28=3.8,
            )
            session.add(sigma)

            session.commit()

        self.client = TestClient(app)
        self.admin_token = create_access_token({"sub": "admin@dfios.com", "role": "Admin", "token_version": 1})
        self.manager_token = create_access_token({"sub": "manager@dfios.com", "role": "Warehouse Manager", "token_version": 1})
        self.viewer_token = create_access_token({"sub": "viewer@dfios.com", "role": "Viewer", "token_version": 1})

    def tearDown(self):
        app.dependency_overrides.clear()

    # --- UC17, UC18, UC19: Forecast Views & Horizon & Filters ---

    def test_forecast_list_unauthenticated(self):
        res = self.client.get("/api/v1/forecasts")
        self.assertEqual(res.status_code, 401)

    def test_forecast_list_viewer_success(self):
        res = self.client.get(
            "/api/v1/forecasts",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total"], 28)
        self.assertEqual(len(data["items"]), 28)
        self.assertEqual(data["horizon"], 28)

    def test_forecast_horizon_selection(self):
        # Horizon 7
        res7 = self.client.get(
            "/api/v1/forecasts?horizon=7",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res7.status_code, 200)
        data7 = res7.json()
        self.assertEqual(data7["total"], 7)
        self.assertEqual(data7["horizon"], 7)

        # Horizon 14
        res14 = self.client.get(
            "/api/v1/forecasts?horizon=14",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res14.status_code, 200)
        self.assertEqual(res14.json()["total"], 14)

        # Horizon invalid (ví dụ 10) -> 422
        res_invalid = self.client.get(
            "/api/v1/forecasts?horizon=10",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_invalid.status_code, 422)

    def test_forecast_filter_by_sku_and_category(self):
        # Filter item_id
        res = self.client.get(
            "/api/v1/forecasts?item_id=FOODS_1_001",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["total"], 28)

        # Filter category matches FOODS
        res_cat = self.client.get(
            "/api/v1/forecasts?category=FOODS",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_cat.status_code, 200)
        self.assertEqual(res_cat.json()["total"], 28)

        # Filter non-existent category
        res_empty = self.client.get(
            "/api/v1/forecasts?category=NON_EXISTENT",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_empty.status_code, 200)
        self.assertEqual(res_empty.json()["total"], 0)

    # --- UC20: Historical Demand ---

    def test_historical_demand_granularities(self):
        # Daily
        res = self.client.get(
            "/api/v1/forecasts/FOODS_1_001/history?granularity=daily",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["granularity"], "daily")
        self.assertEqual(data["count"], 14)
        self.assertGreater(data["total_quantity"], 0)

        # Weekly
        res_w = self.client.get(
            "/api/v1/forecasts/FOODS_1_001/history?granularity=weekly",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_w.status_code, 200)
        self.assertEqual(res_w.json()["granularity"], "weekly")

        # Monthly
        res_m = self.client.get(
            "/api/v1/forecasts/FOODS_1_001/history?granularity=monthly",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_m.status_code, 200)
        self.assertEqual(res_m.json()["granularity"], "monthly")

        # Invalid granularity -> 422
        res_inv = self.client.get(
            "/api/v1/forecasts/FOODS_1_001/history?granularity=yearly",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_inv.status_code, 422)

        # Non-existent SKU -> 404
        res_404 = self.client.get(
            "/api/v1/forecasts/UNKNOWN_SKU/history",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_404.status_code, 404)

    # --- UC21: Compare Actual vs Predicted ---

    def test_compare_actual_vs_predicted(self):
        res = self.client.get(
            "/api/v1/forecasts/FOODS_1_001/compare",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["item_id"], "FOODS_1_001")
        self.assertEqual(data["metrics"]["data_points"], 14)
        self.assertEqual(data["metrics"]["mae"], 1.0)
        self.assertEqual(data["metrics"]["rmse"], 1.0)
        self.assertEqual(len(data["comparison"]), 14)

    # --- UC22: Prediction Uncertainty Band ---

    def test_uncertainty_band(self):
        res = self.client.get(
            "/api/v1/forecasts/FOODS_1_001/uncertainty?horizon=28",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["item_id"], "FOODS_1_001")
        self.assertEqual(data["horizon"], 28)
        self.assertEqual(data["sigma_h"], 3.8)
        self.assertEqual(len(data["points"]), 28)
        self.assertIsNotNone(data["error_distribution"])
        self.assertEqual(data["error_distribution"]["mean"], 4.0)

    # --- UC23: View Forecast Explanation (SHAP) ---

    def test_shap_explanation_role_access(self):
        # Viewer -> 403 Forbidden
        res_viewer = self.client.get(
            "/api/v1/forecasts/FOODS_1_001/explanation",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_viewer.status_code, 403)

        # Manager -> 200 OK
        res_mgr = self.client.get(
            "/api/v1/forecasts/FOODS_1_001/explanation",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_mgr.status_code, 200)
        data = res_mgr.json()
        self.assertEqual(data["model_name"], "lightgbm")
        self.assertGreater(len(data["features"]), 0)

        # ARIMA model -> 404 Not Found kèm thông báo rõ ràng
        res_arima = self.client.get(
            "/api/v1/forecasts/FOODS_1_001/explanation?model_name=arima",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_arima.status_code, 404)
        self.assertIn("ARIMA không hỗ trợ giải thích SHAP", res_arima.json()["detail"])

    # --- UC24: Manual Forecast Override & Revert ---

    def test_manual_override_permissions(self):
        payload = {
            "forecast_date": "2026-10-01",
            "override_value": 25.0,
            "reason": "Điều chỉnh do có khuyến mãi đột xuất",
            "store_id": "CA_1",
        }
        # Viewer -> 403
        res_viewer = self.client.post(
            "/api/v1/forecasts/FOODS_1_001/override",
            json=payload,
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_viewer.status_code, 403)

        # Manager -> 201 Created
        res_mgr = self.client.post(
            "/api/v1/forecasts/FOODS_1_001/override",
            json=payload,
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_mgr.status_code, 201)
        ov_data = res_mgr.json()
        self.assertEqual(ov_data["override_value"], 25.0)
        self.assertEqual(ov_data["original_value"], 11.0)
        self.assertTrue(ov_data["is_active"])
        override_id = ov_data["id"]

        # Kiểm tra GET /forecasts đã áp dụng giá trị override mới
        res_list = self.client.get(
            "/api/v1/forecasts?item_id=FOODS_1_001&horizon=7",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_list.status_code, 200)
        items = res_list.json()["items"]
        item_day1 = next(it for it in items if it["forecast_date"] == "2026-10-01")
        self.assertEqual(item_day1["y_pred"], 25.0)
        self.assertTrue(item_day1["is_overridden"])
        self.assertEqual(item_day1["original_value"], 11.0)
        self.assertEqual(item_day1["override_reason"], "Điều chỉnh do có khuyến mãi đột xuất")

        # Hoàn tác override (DELETE)
        res_rev = self.client.delete(
            f"/api/v1/forecasts/FOODS_1_001/override/{override_id}",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_rev.status_code, 200)
        self.assertTrue(res_rev.json()["success"])

        # Kiểm tra GET /forecasts sau hoàn tác đã khôi phục về giá trị gốc (11.0)
        res_list_after = self.client.get(
            "/api/v1/forecasts?item_id=FOODS_1_001&horizon=7",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        item_day1_after = next(it for it in res_list_after.json()["items"] if it["forecast_date"] == "2026-10-01")
        self.assertEqual(item_day1_after["y_pred"], 11.0)
        self.assertFalse(item_day1_after["is_overridden"])

        # Kiểm tra Audit Log đã ghi nhận cả 2 thao tác override và revert
        with self.TestingSessionLocal() as session:
            logs = session.query(AuditLog).all()
            actions = [l.action for l in logs]
            self.assertIn("forecast.override", actions)
            self.assertIn("forecast.revert_override", actions)

    def test_override_validations(self):
        # Empty reason -> 400 Bad Request
        res_empty = self.client.post(
            "/api/v1/forecasts/FOODS_1_001/override",
            json={
                "forecast_date": "2026-10-01",
                "override_value": 20.0,
                "reason": "   ",
            },
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_empty.status_code, 400)

        # Date without forecast -> 404 Not Found
        res_no_date = self.client.post(
            "/api/v1/forecasts/FOODS_1_001/override",
            json={
                "forecast_date": "2030-01-01",
                "override_value": 20.0,
                "reason": "Không có dự báo ngày này",
            },
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_no_date.status_code, 404)


    # UC25: Bulk Override với validation
    def test_bulk_override_role_validation(self):
        payload = {
            "items": [
                {
                    "store_id": "CA_1",
                    "item_id": "FOODS_1_001",
                    "date": "2026-10-01",
                    "value": 20.0,
                    "reason": "Test bulk override"
                }
            ]
        }
        
        # Viewer: 403 Forbidden
        res = self.client.post(
            "/api/v1/forecasts/bulk-override",
            json=payload,
            headers={"Authorization": f"Bearer {self.viewer_token}"}
        )
        self.assertEqual(res.status_code, 403)
    
    def test_bulk_override_validation_rules(self):
        # Admin user để pass role check
        payload = {
            "items": [
                # 1. Invalid date (không tồn tại)
                {
                    "store_id": "CA_1",
                    "item_id": "FOODS_1_001",
                    "date": "2030-01-01",
                    "value": 20.0,
                    "reason": "Invalid date"
                },
                # 2. Empty reason
                {
                    "store_id": "CA_1",
                    "item_id": "FOODS_1_001",
                    "date": "2026-10-01",
                    "value": 20.0,
                    "reason": " "
                },
                # 3. Invalid item_id
                {
                    "store_id": "CA_1",
                    "item_id": "INVALID_ITEM",
                    "date": "2026-10-01",
                    "value": 20.0,
                    "reason": "Invalid item"
                }
            ]
        }
        
        res = self.client.post(
            "/api/v1/forecasts/bulk-override",
            json=payload,
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        
        self.assertEqual(res.status_code, 422)
        data = res.json()
        
        # Validate error format
        self.assertIn("detail", data)
        self.assertIsInstance(data["detail"], list)
        self.assertTrue(len(data["detail"]) > 0)
        
        for error in data["detail"]:
            self.assertIn("type", error)
            self.assertIn("loc", error)
            self.assertIn("msg", error)
            
        # Validate specific error types
        error_types = [err["type"] for err in data["detail"]]
        self.assertIn("value_error", error_types)
        self.assertIn("type_error.str.strip", error_types)
    
    # UC26: Bulk Override thành công với tất cả valid records
    def test_bulk_override_success(self):
        with self.TestingSessionLocal() as session:
            session.add(
                Forecast(
                    id="fc_foods_2_day2",
                    item_id="FOODS_1_002",
                    store_id="CA_1",
                    forecast_date=date(2026, 10, 2),
                    h=2,
                    y_pred=12.0,
                    p10=10.0,
                    p50=12.0,
                    p90=14.0,
                    available=True,
                    model_version="v1.0.0",
                )
            )
            session.commit()

        # Tạo override hợp lệ cho ngày 2026-10-01
        payload = {
            "items": [
                {
                    "store_id": "CA_1",
                    "item_id": "FOODS_1_001",
                    "date": "2026-10-01",
                    "value": 30.0,
                    "reason": "Test bulk success 1"
                },
                {
                    "store_id": "CA_1",
                    "item_id": "FOODS_1_002",  # Item khác
                    "date": "2026-10-02",  # Date khác
                    "value": 15.0,
                    "reason": "Test bulk success 2"
                }
            ]
        }
        
        res = self.client.post(
            "/api/v1/forecasts/bulk-override",
            json=payload,
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        
        self.assertEqual(res.status_code, 201)
        data = res.json()
        
        self.assertIn("success", data)
        self.assertIn("created_count", data)
        self.assertIn("skipped_count", data)
        self.assertIn("errors", data)
        
        self.assertEqual(data["success"], True)
        self.assertEqual(data["created_count"], 2)
        self.assertEqual(data["skipped_count"], 0)
        self.assertEqual(data["errors"], [])
        
        # Verify records created
        with self.TestingSessionLocal() as session:
            # Check first record
            created_1 = session.query(ForecastOverride).filter(
                ForecastOverride.item_id == "FOODS_1_001",
                ForecastOverride.store_id == "CA_1",
                ForecastOverride.forecast_date == date(2026, 10, 1)
            ).first()
            self.assertIsNotNone(created_1)
            self.assertEqual(created_1.override_value, 30.0)
            self.assertTrue(created_1.is_active)
            
            # Check second record
            created_2 = session.query(ForecastOverride).filter(
                ForecastOverride.item_id == "FOODS_1_002",
                ForecastOverride.store_id == "CA_1",
                ForecastOverride.forecast_date == date(2026, 10, 2)
            ).first()
            self.assertIsNotNone(created_2)
            self.assertEqual(created_2.override_value, 15.0)
            self.assertTrue(created_2.is_active)


    # UC27: Bulk Override - Một phần valid, một phần invalid
    def test_bulk_override_mixed_results(self):
        payload = {
            "items": [
                # Valid override
                {
                    "store_id": "CA_1",
                    "item_id": "FOODS_1_001",
                    "date": "2026-10-02",
                    "value": 40.0,
                    "reason": "Valid test"
                },
                # Invalid date
                {
                    "store_id": "CA_1",
                    "item_id": "FOODS_1_001",
                    "date": "2030-01-01",
                    "value": 20.0,
                    "reason": "Invalid date"
                },
                # Invalid item_id
                {
                    "store_id": "CA_1",
                    "item_id": "INVALID_ITEM",
                    "date": "2026-10-03",
                    "value": 25.0,
                    "reason": "Invalid item"
                }
            ]
        }
        
        res = self.client.post(
            "/api/v1/forecasts/bulk-override",
            json=payload,
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        
        self.assertEqual(res.status_code, 201)
        data = res.json()
        
        # Validate counts
        self.assertEqual(data["success"], True)
        self.assertEqual(data["created_count"], 1)
        self.assertEqual(data["skipped_count"], 2)
        self.assertEqual(len(data["errors"]), 2)
        
        # Verify created record
        with self.TestingSessionLocal() as session:
            created = session.query(ForecastOverride).filter(
                ForecastOverride.item_id == "FOODS_1_001",
                ForecastOverride.store_id == "CA_1",
                ForecastOverride.forecast_date == date(2026, 10, 2),
            ).first()
            self.assertIsNotNone(created)
            self.assertEqual(created.override_value, 40.0)
            self.assertTrue(created.is_active)