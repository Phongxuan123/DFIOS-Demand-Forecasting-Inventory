"""Test isolation: never read the real M5 CSV (tests build their own tiny sales fixtures)."""
import pytest

from app.services.window_quantile_service import m5_actuals


@pytest.fixture(autouse=True)
def _no_m5_csv():
    m5_actuals.configure("")  # empty path => CSV disabled
    yield
    m5_actuals.configure(None)
