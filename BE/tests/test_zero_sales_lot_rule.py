"""research_v2 §6.3 / H9: lot for SKUs with no sale in the 56 days before the review (opt-in rule)."""
import numpy as np
import pytest

from app.services import policy_config as pc
from app.services.optimization_service import OptimizationService

rate = OptimizationService.eoq_demand_rate


def test_default_is_the_teacher_rule():
    """OFF by default: the E6 reproduction and the demo numbers are measured with the teacher EOQ."""
    assert pc.ZERO_SALES_LOT_FROM_FORECAST is False
    assert rate(0.0, 5.0, 30.0, 10) == (0.0, "sales_56d")


def test_recent_sales_always_use_the_56_day_mean():
    assert rate(2.5, 5.0, 30.0, 10, enabled=True) == (2.5, "sales_56d")
    assert rate(2.5, 5.0, 30.0, 10, enabled=False) == (2.5, "sales_56d")


def test_no_recent_sale_with_reorder_point_takes_the_forecast_rate():
    mu, basis = rate(0.0, 4.0, 30.0, 10, enabled=True)
    assert basis == "forecast_window" and mu == pytest.approx(3.0)
    eoq = OptimizationService.teacher_eoq(np.array([mu]), np.array([5.0]))[0]
    assert eoq > 0  # the lot is no longer 0, so S = s + ceil(kappa * EOQ) > s


@pytest.mark.parametrize("mean56, s, F", [(None, 4.0, 30.0), (0.0, 0.0, 30.0), (0.0, 4.0, 0.0), (0.0, 4.0, None)])
def test_rule_stays_off_when_nothing_calls_for_stock(mean56, s, F):
    """No reorder point (s = 0) or no forecast: keep EOQ from the sales (0), never invent demand."""
    mu, basis = rate(mean56, s, F, 10, enabled=True)
    if s > 0 and F:
        assert basis == "forecast_window"
    else:
        assert (mu, basis) == (0.0, "sales_56d")


def test_flag_follows_the_module_setting(monkeypatch):
    monkeypatch.setattr(pc, "ZERO_SALES_LOT_FROM_FORECAST", True)
    assert rate(0.0, 2.0, 10.0, 10) == (1.0, "forecast_window")
