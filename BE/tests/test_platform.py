"""Kiểm thử lớp nền tảng: manifest artifact, bootstrap guard, phân trang products (R-35), SSE role (B-25)."""
import os
import sys
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.models.base import Base
from app.models.product import Product
from app.models.user import User
from app.schemas.event import INVENTORY_EVENT_ROLES, create_inventory_updated_event, create_stock_alert_event

SCRIPTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts")
sys.path.insert(0, SCRIPTS_DIR)
import bootstrap  # noqa: E402
import check_artifacts  # noqa: E402


class TestArtifactsManifest(unittest.TestCase):
    def test_manifest_is_well_formed(self):
        manifest = check_artifacts.load_manifest()
        self.assertGreater(len(manifest["files"]), 0)
        for entry in manifest["files"]:
            self.assertIn(entry["location"], ("scripts", "MODEL"))
            self.assertEqual(len(entry["sha256"]), 64)
            self.assertGreater(entry["size"], 0)

    def test_missing_and_mismatched_artifacts_reported(self):
        original = check_artifacts.load_manifest
        fake = {"files": [
            {"name": "does_not_exist.parquet", "location": "scripts", "purpose": "x", "size": 1, "sha256": "0" * 64},
            {"name": "artifacts_manifest.json", "location": "scripts", "purpose": "x", "size": 1, "sha256": "0" * 64},
        ]}
        check_artifacts.load_manifest = lambda: fake
        old_env = os.environ.pop("DFIOS_ARTIFACTS_DIR", None)
        try:
            problems = check_artifacts.check()
        finally:
            check_artifacts.load_manifest = original
            if old_env is not None:
                os.environ["DFIOS_ARTIFACTS_DIR"] = old_env
        self.assertTrue(problems[0].startswith("MISSING"))
        self.assertTrue(problems[1].startswith("SIZE"))

    def test_bootstrap_db_host_parsing(self):
        self.assertEqual(bootstrap._db_host("postgresql+psycopg2://u:p@localhost:5432/db"), "localhost")
        self.assertEqual(bootstrap._db_host("postgresql+psycopg2://u:p@db.example.com:5432/db"), "db.example.com")
        self.assertNotIn("db.example.com", bootstrap.LOCAL_HOSTS)

    def test_bootstrap_refuses_shared_database_without_flag(self):
        """Bootstrap thay dữ liệu trong bảng, nên phải từ chối DB không phải localhost khi thiếu --i-know."""
        import check_artifacts
        old_argv, old_url, original_check = sys.argv, os.environ.get("DATABASE_URL"), check_artifacts.check
        sys.argv = ["bootstrap.py", "--skip-checksum"]
        os.environ["DATABASE_URL"] = "postgresql+psycopg2://u:p@shared.example.com:5432/postgres"
        check_artifacts.check = lambda quick=False: []
        try:
            self.assertEqual(bootstrap.main(), 2)
        finally:
            sys.argv, check_artifacts.check = old_argv, original_check
            if old_url is None:
                os.environ.pop("DATABASE_URL", None)
            else:
                os.environ["DATABASE_URL"] = old_url


class TestEventRoles(unittest.TestCase):
    def test_inventory_publisher_restricts_roles(self):
        self.assertNotIn("Viewer", INVENTORY_EVENT_ROLES)
        ev = create_inventory_updated_event("A", "admin@x.com", target_roles=list(INVENTORY_EVENT_ROLES))
        self.assertIn("Admin", ev.target_roles)
        self.assertIn("Warehouse Manager", ev.target_roles)

    def test_stock_alert_stays_broadcast(self):
        ev = create_stock_alert_event("A", "CA_1", "CRITICAL", 0, 1, 1, "m")
        self.assertIsNone(ev.target_roles)


class TestProductsPagination(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        self.Session = sessionmaker(autocommit=False, autoflush=False, bind=self.engine, expire_on_commit=False)
        Base.metadata.create_all(bind=self.engine)

        def override_get_db():
            db = self.Session()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        with self.Session() as s:
            s.add(User(id="v1", email="viewer@dfios.com", password_hash=get_password_hash("Viewer123"),
                       role="Viewer", display_name="V", is_active=True, is_verified=True, token_version=1))
            for i in range(25):
                s.add(Product(item_id=f"FOODS_1_{i:03d}", name=f"Item {i}", dept_id="FOODS_1", cat_id="FOODS", price=float(i + 1)))
            s.commit()
        self.client = TestClient(app)
        self.headers = {"Authorization": f"Bearer {self._token()}"}

    def _token(self):
        return create_access_token(
            data={"sub": "viewer@dfios.com", "role": "Viewer", "user_id": "v1", "token_version": 1}
        )

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_page_and_total_header(self):
        r = self.client.get("/api/v1/products?page=2&page_size=10", headers=self.headers)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(r.headers["X-Total-Count"], "25")
        self.assertEqual(body["total"], 25)
        self.assertEqual(len(body["items"]), 10)
        self.assertEqual(body["items"][0]["item_id"], "FOODS_1_010")

    def test_sort_and_q(self):
        r = self.client.get("/api/v1/products?sort_by=price&sort_dir=desc&limit=3", headers=self.headers)
        self.assertEqual([p["item_id"] for p in r.json()["items"]][0], "FOODS_1_024")
        r = self.client.get("/api/v1/products?q=Item 7", headers=self.headers)
        self.assertEqual(r.json()["total"], 1)

    def test_legacy_shape_without_new_params(self):
        r = self.client.get("/api/v1/products?skip=0&limit=5", headers=self.headers)
        self.assertEqual(set(r.json().keys()), {"items", "total", "skip", "limit"})


if __name__ == "__main__":
    unittest.main()
