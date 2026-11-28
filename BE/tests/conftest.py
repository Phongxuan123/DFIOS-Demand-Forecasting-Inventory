"""Test isolation: never read the real M5 CSV (tests build their own tiny sales fixtures)."""
import os

# app.core.config refuses to start without a real JWT secret (H6); CI has no BE/.env, so give the suite a
# throwaway one before anything imports the app. A secret already in the environment or BE/.env wins.
os.environ.setdefault("JWT_SECRET_KEY", "test-only-jwt-secret-not-for-any-real-deployment-0001")

import pytest  # noqa: E402

from app.services.window_quantile_service import m5_actuals


@pytest.fixture(autouse=True)
def _no_m5_csv():
    m5_actuals.configure("")  # empty path => CSV disabled
    yield
    m5_actuals.configure(None)


@pytest.fixture(autouse=True)
def _fresh_result_cache():
    """Each test builds its own database: never serve a response cached for another one (H5 result cache)."""
    from app.services import result_cache
    result_cache.clear()
    yield
    result_cache.clear()
