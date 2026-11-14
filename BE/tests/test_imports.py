"""
Kiểm thử luồng import CSV kho hàng và fast-inference:
P-03 / N-22 (ngày ISO không bị đảo), P-07 (fast-inference không còn 500), P-26 (một kho duy nhất),
N-09 (không tự tạo Product, giới hạn kích thước), N-23 (template), R-38 (inserted/updated/rejected).
"""
import io
import unittest
from datetime import date

import pandas as pd
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.api.deps import get_db
from app.api.v1.endpoints import imports as imports_endpoint
from app.core.security import create_access_token, get_password_hash
from app.models.base import Base
from app.models.forecast import Forecast
from app.models.inventory import Inventory
from app.models.product import Product
from app.models.sales_history import SalesHistory
from app.models.sim_clock import SimClock
from app.models.user import User
from app.services.data_preprocessing_service import data_preprocessing_service, parse_sale_dates


class TestParseSaleDates(unittest.TestCase):
    def test_iso_dates_are_never_flipped(self):
        """P-03: 2016-04-05 phải là 5 tháng 4, không phải 4 tháng 5."""
        parsed, info = parse_sale_dates(pd.Series(["2016-04-05", "2016-04-06", "2016-12-01 08:30:00"]))
        self.assertEqual(list(parsed), [pd.Timestamp("2016-04-05"), pd.Timestamp("2016-04-06"), pd.Timestamp("2016-12-01")])
        self.assertEqual(info["date_format"], "YYYY-MM-DD")
        self.assertEqual(info["invalid_dates"], 0)

    def test_dayfirst_detected_from_column(self):
        parsed, info = parse_sale_dates(pd.Series(["05/04/2016", "25/04/2016"]))
        self.assertEqual(list(parsed), [pd.Timestamp("2016-04-05"), pd.Timestamp("2016-04-25")])
        self.assertEqual(info["date_format"], "DD/MM/YYYY")
        self.assertEqual(info["warnings"], [])

    def test_monthfirst_detected_from_column(self):
        parsed, info = parse_sale_dates(pd.Series(["04/05/2016", "04/25/2016"]))
        self.assertEqual(list(parsed), [pd.Timestamp("2016-04-05"), pd.Timestamp("2016-04-25")])
        self.assertEqual(info["date_format"], "MM/DD/YYYY")

    def test_fully_ambiguous_defaults_to_dayfirst_with_warning(self):
        parsed, info = parse_sale_dates(pd.Series(["05/04/2016", "06/04/2016"]))
        self.assertEqual(list(parsed), [pd.Timestamp("2016-04-05"), pd.Timestamp("2016-04-06")])
        self.assertEqual(len(info["warnings"]), 1)

    def test_mixed_iso_and_dmy_rejected(self):
        with self.assertRaises(ValueError) as ctx:
            parse_sale_dates(pd.Series(["2016-04-05", "05/04/2016"]))
        self.assertIn("trộn nhiều định dạng", str(ctx.exception))

    def test_contradictory_dmy_rejected(self):
        with self.assertRaises(ValueError):
            parse_sale_dates(pd.Series(["25/04/2016", "04/25/2016"]))

    def test_invalid_values_become_nat(self):
        parsed, info = parse_sale_dates(pd.Series(["2016-02-30", "hello", "2016-04-05"]))
        self.assertTrue(pd.isna(parsed.iloc[0]))
        self.assertTrue(pd.isna(parsed.iloc[1]))
        self.assertEqual(parsed.iloc[2], pd.Timestamp("2016-04-05"))
        self.assertEqual(info["invalid_dates"], 2)

    def test_preprocess_rejects_and_reports_rows(self):
        csv_bytes = (
            "item_id,store_id,sale_date,quantity,sell_price\n"
            "SKU_A,CA_9,2016-04-05,3,2.5\n"
            "SKU_A,TX_1,2016-04-06,4,2.5\n"      # kho khác
            "SKU_X,CA_9,2016-04-05,1,2.5\n"      # SKU lạ
            "SKU_A,CA_9,not-a-date,1,2.5\n"      # ngày hỏng
            "SKU_A,CA_9,2016-04-07,-2,2.5\n"     # số âm
            "SKU_A,,2016-04-08,6,2.5\n"          # store trống → kho đích
        ).encode("utf-8")
        clean_df, report = data_preprocessing_service.preprocess_sales_data(
            csv_bytes, default_store_id="CA_9", known_item_ids={"SKU_A"}
        )
        self.assertEqual(report["rejected_count"], 4)
        self.assertEqual(report["accepted_rows"], 2)
        reasons = " | ".join(r["reason"] for r in report["rejected_rows"])
        self.assertIn("store_id khác kho đích", reasons)
        self.assertIn("không tồn tại trong danh mục", reasons)
        self.assertIn("sale_date không hợp lệ", reasons)
        self.assertIn("quantity", reasons)
        self.assertEqual(set(clean_df["store_id"]), {"CA_9"})
        self.assertEqual(set(clean_df["item_id"]), {"SKU_A"})
        # Q-02: only the 2 accepted dates (04-05 and 04-08); 06 and 07 are NOT invented as 0
        self.assertEqual(len(clean_df), 2)
        filled, _ = data_preprocessing_service.preprocess_sales_data(
            csv_bytes, default_store_id="CA_9", known_item_ids={"SKU_A"}, fill_gaps=True)
        self.assertEqual(len(filled), 4)  # legacy behaviour is still available explicitly
        self.assertEqual(clean_df["sale_date"].min(), pd.Timestamp("2016-04-05"))
        self.assertEqual(clean_df["sale_date"].max(), pd.Timestamp("2016-04-08"))


class TestImportEndpoints(unittest.TestCase):
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
            session.add(User(
                id="admin-01", email="admin@dfios.com", password_hash=get_password_hash("Admin123"),
                role="Admin", display_name="Admin", is_active=True, is_verified=True, token_version=1,
            ))
            session.add(User(
                id="viewer-01", email="viewer@dfios.com", password_hash=get_password_hash("Viewer123"),
                role="Viewer", display_name="Viewer", is_active=True, is_verified=True, token_version=1,
            ))
            session.add(Product(item_id="SKU_A", name="A", cat_id="FOODS", dept_id="FOODS_1", price=2.0))
            session.add(Product(item_id="SKU_B", name="B", cat_id="FOODS", dept_id="FOODS_1", price=3.0))
            session.commit()

        self.client = TestClient(app)
        self.admin_headers = {
            "Authorization": "Bearer " + create_access_token({"sub": "admin@dfios.com", "role": "Admin", "tv": 1})
        }
        self.viewer_headers = {
            "Authorization": "Bearer " + create_access_token({"sub": "viewer@dfios.com", "role": "Viewer", "tv": 1})
        }

    def tearDown(self):
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=self.engine)

    def _upload(self, csv_text: str, store_id: str = "NEW_1", name: str = "sales.csv"):
        return self.client.post(
            f"/api/v1/imports?store_id={store_id}",
            files={"file": (name, io.BytesIO(csv_text.encode("utf-8")), "text/csv")},
            headers=self.admin_headers,
        )

    def test_iso_dates_written_unflipped_and_counters_present(self):
        res = self._upload(
            "item_id,store_id,sale_date,quantity,sell_price\n"
            "SKU_A,NEW_1,2016-04-05,3,2.5\n"
            "SKU_A,NEW_1,2016-04-06,4,2.5\n"
            "SKU_B,NEW_1,2016-04-05,1,2.5\n"
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        for key in ("inserted", "updated", "rejected", "rows_cleaned", "import_id", "quality_report", "message"):
            self.assertIn(key, data)
        self.assertEqual((data["inserted"], data["updated"], data["rejected"]), (3, 0, 0))
        self.assertEqual(data["quality_report"]["date_format"], "YYYY-MM-DD")

        with self.TestingSessionLocal() as session:
            dates = sorted({h.sale_date for h in session.query(SalesHistory).all()})
            self.assertEqual(dates, [date(2016, 4, 5), date(2016, 4, 6)])
            clock = session.query(SimClock).filter(SimClock.store_id == "NEW_1").one()
            self.assertEqual(clock.current_date, date(2016, 4, 5))  # Q-11: not pre-advanced
            self.assertEqual(clock.start_date, date(2016, 4, 5))

        # Nạp lại cùng file: không trùng khóa, toàn bộ là cập nhật
        res2 = self._upload(
            "item_id,store_id,sale_date,quantity,sell_price\n"
            "SKU_A,NEW_1,2016-04-05,9,2.5\n"
            "SKU_A,NEW_1,2016-04-06,4,2.5\n"
        )
        self.assertEqual(res2.status_code, 200, res2.text)
        self.assertEqual((res2.json()["inserted"], res2.json()["updated"]), (0, 2))
        with self.TestingSessionLocal() as session:
            row = session.query(SalesHistory).filter(
                SalesHistory.item_id == "SKU_A", SalesHistory.sale_date == date(2016, 4, 5)
            ).one()
            self.assertEqual(row.quantity, 9.0)

    def test_gaps_are_never_zero_filled_and_existing_sales_untouched(self):
        """Q-02: a second file with a gap must not overwrite 04-06 / 04-07 with 0."""
        res = self._upload(
            "item_id,store_id,sale_date,quantity\n"
            "SKU_A,NEW_1,2016-04-05,2\nSKU_A,NEW_1,2016-04-06,4\nSKU_A,NEW_1,2016-04-07,5\n"
        )
        self.assertEqual(res.status_code, 200, res.text)
        res2 = self._upload(
            "item_id,store_id,sale_date,quantity\n"
            "SKU_A,NEW_1,2016-04-05,2\nSKU_A,NEW_1,2016-04-08,7\n"
        )
        self.assertEqual(res2.status_code, 200, res2.text)
        self.assertEqual((res2.json()["inserted"], res2.json()["updated"]), (1, 1))
        with self.TestingSessionLocal() as session:
            q = {h.sale_date: h.quantity for h in session.query(SalesHistory).filter(SalesHistory.item_id == "SKU_A")}
        self.assertEqual(q[date(2016, 4, 6)], 4.0)
        self.assertEqual(q[date(2016, 4, 7)], 5.0)
        self.assertEqual(q[date(2016, 4, 8)], 7.0)
        self.assertEqual(len(q), 4)

    def test_unknown_sku_rejected_not_created(self):
        res = self._upload(
            "item_id,sale_date,quantity\n"
            "SKU_A,2016-04-05,3\n"
            "GHOST_1,2016-04-05,7\n"
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual((data["inserted"], data["rejected"]), (1, 1))
        self.assertEqual(data["rejected_rows"][0]["item_id"], "GHOST_1")
        with self.TestingSessionLocal() as session:
            self.assertIsNone(session.query(Product).filter(Product.item_id == "GHOST_1").first())
            self.assertEqual(session.query(SalesHistory).count(), 1)
            self.assertEqual(session.query(Inventory).filter(Inventory.item_id == "GHOST_1").count(), 0)

    def test_rows_of_other_store_rejected_single_store_written(self):
        res = self._upload(
            "item_id,store_id,sale_date,quantity\n"
            "SKU_A,NEW_1,2016-04-05,3\n"
            "SKU_A,OTHER_9,2016-04-05,5\n"
        )
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual((res.json()["inserted"], res.json()["rejected"]), (1, 1))
        with self.TestingSessionLocal() as session:
            self.assertEqual({h.store_id for h in session.query(SalesHistory).all()}, {"NEW_1"})
            self.assertEqual({i.store_id for i in session.query(Inventory).all()}, {"NEW_1"})

    def test_mixed_date_formats_return_400(self):
        res = self._upload(
            "item_id,sale_date,quantity\n"
            "SKU_A,2016-04-05,3\n"
            "SKU_A,06/04/2016,3\n"
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("định dạng", res.json()["detail"])
        with self.TestingSessionLocal() as session:
            self.assertEqual(session.query(SalesHistory).count(), 0)

    def test_oversized_upload_rejected_with_413(self):
        original = imports_endpoint.MAX_IMPORT_BYTES
        imports_endpoint.MAX_IMPORT_BYTES = 64
        try:
            res = self._upload("item_id,sale_date,quantity\n" + "SKU_A,2016-04-05,3\n" * 50)
        finally:
            imports_endpoint.MAX_IMPORT_BYTES = original
        self.assertEqual(res.status_code, 413)

    def test_non_csv_and_viewer_blocked(self):
        res = self._upload("a,b\n1,2\n", name="sales.xlsx")
        self.assertEqual(res.status_code, 400)
        res_viewer = self.client.post(
            "/api/v1/imports?store_id=NEW_1",
            files={"file": ("s.csv", io.BytesIO(b"item_id,sale_date,quantity\nSKU_A,2016-04-05,3\n"), "text/csv")},
            headers=self.viewer_headers,
        )
        self.assertEqual(res_viewer.status_code, 403)

    def test_template_spec_matches_csv_template(self):
        spec = self.client.get("/api/v1/imports/template", headers=self.viewer_headers)
        self.assertEqual(spec.status_code, 200)
        body = spec.json()
        self.assertEqual(body["header"], ["item_id", "store_id", "sale_date", "quantity", "sell_price"])
        self.assertEqual(body["required"], ["item_id", "sale_date", "quantity"])
        csv_res = self.client.get("/api/v1/imports/template?format=csv", headers=self.viewer_headers)
        self.assertEqual(csv_res.status_code, 200)
        self.assertEqual(csv_res.text.splitlines()[0].strip(), ",".join(body["header"]))
        legacy = self.client.get("/api/v1/data/template", headers=self.viewer_headers)
        self.assertEqual(legacy.text, csv_res.text)

    def test_fast_inference_runs_and_is_idempotent(self):
        """P-07: trước đây luôn 500 (gọi hàm không tồn tại, sale_date không phải datetime)."""
        lines = ["item_id,sale_date,quantity"]
        for d in range(1, 29):
            lines.append(f"SKU_A,2016-03-{d:02d},{d % 4}")
            lines.append(f"SKU_B,2016-03-{d:02d},{(d * 3) % 5}")
        self.assertEqual(self._upload("\n".join(lines) + "\n").status_code, 200)

        for _ in range(2):
            res = self.client.post(
                "/api/v1/forecast/fast-inference",
                json={"store_id": "NEW_1", "horizon": 14},
                headers=self.admin_headers,
            )
            self.assertEqual(res.status_code, 200, res.text)
            data = res.json()
            self.assertEqual(data["skus_forecasted"], 2)
            self.assertEqual(data["records_generated"], 28)

        with self.TestingSessionLocal() as session:
            rows = session.query(Forecast).filter(Forecast.store_id == "NEW_1").all()
            self.assertEqual(len(rows), 28)
            self.assertEqual({r.model_version for r in rows}, {"fast-inference-sba"})
            self.assertEqual(min(r.forecast_date for r in rows), date(2016, 3, 29))
            self.assertTrue(all(r.p10 <= r.p50 <= r.p90 for r in rows))

    def test_fast_inference_404_without_sales(self):
        res = self.client.post(
            "/api/v1/forecast/fast-inference",
            json={"store_id": "EMPTY_1", "horizon": 14},
            headers=self.admin_headers,
        )
        self.assertEqual(res.status_code, 404)


if __name__ == "__main__":
    unittest.main()
