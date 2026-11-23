"""demo.md §6.3 POST /auth/refresh; only access tokens authenticate API calls."""
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core.security import create_password_reset_token, create_refresh_token, get_password_hash
from app.main import app
from app.models.base import Base
from app.models.user import User


class TestAuthRefresh(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=engine)
        self.Session = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)

        def override():
            db = self.Session()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override
        with self.Session() as s:
            s.add(User(id="u1", email="planner@dfios.com", password_hash=get_password_hash("Planner123"),
                       role="Planner", display_name="P", is_active=True, is_verified=True, token_version=1))
            s.commit()
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.pop(get_db, None)

    def _login(self):
        r = self.client.post("/api/v1/auth/login", json={"email": "planner@dfios.com", "password": "Planner123"})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_login_gives_a_refresh_token_that_renews_the_access_token(self):
        tokens = self._login()
        self.assertTrue(tokens.get("refresh_token"))
        r = self.client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        self.assertEqual(r.status_code, 200, r.text)
        new = r.json()
        me = self.client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {new['access_token']}"})
        self.assertEqual(me.status_code, 200)

    def test_logout_revokes_the_refresh_token(self):
        tokens = self._login()
        out = self.client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {tokens['access_token']}"})
        self.assertEqual(out.status_code, 200)
        r = self.client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        self.assertEqual(r.status_code, 401)

    def test_an_access_token_is_not_a_refresh_token(self):
        tokens = self._login()
        r = self.client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["access_token"]})
        self.assertEqual(r.status_code, 401)

    def test_refresh_and_reset_tokens_do_not_open_the_api(self):
        refresh = create_refresh_token({"sub": "u1", "user_id": "u1", "email": "planner@dfios.com", "token_version": 1})
        reset = create_password_reset_token("planner@dfios.com")
        for tok in (refresh, reset):
            me = self.client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tok}"})
            self.assertEqual(me.status_code, 401)


if __name__ == "__main__":
    unittest.main()
