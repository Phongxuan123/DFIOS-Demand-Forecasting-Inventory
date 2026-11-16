"""
Single source of truth for the scientific policy constants of DFIOS (research.md §3, §7, §8).

Every service / script of the Tier 1-3 core imports from here instead of re-declaring
``L = 3``, ``R = 7``, cost rates, the m-grid, the demo date, etc. (R-28, B-20).

Lead time convention: L = 3, R = 7, H = L + R = 10 days for EVERY SKU, unless the operator
explicitly opts in to supplier lead times via the system setting ``use_supplier_lead_time``
(see ``OptimizationService._resolve_lead_time``).
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import List

import numpy as np

# --- Timing (research.md §3, §7.1) ---------------------------------------------------------
LEAD_TIME_DAYS: int = 3
REVIEW_PERIOD_DAYS: int = 7
HORIZON_DAYS: int = LEAD_TIME_DAYS + REVIEW_PERIOD_DAYS  # H = 10
# Number of days of the window stored in forecast_backtest.dhat (artifact c3ok: W = 10).
BACKTEST_WINDOW_DAYS: int = 10

# --- Costs, assumption A3 (research.md §3.2 / §7.2) ----------------------------------------
HOLDING_RATE_DAILY: float = 0.002  # h = 0.2 % * price / unit / day
STOCKOUT_PENALTY_RATE: float = 0.35  # b = 35 % * price / unit short
ORDER_COST_C: float = 2.0  # c = 2 per order line

# --- Service targets -----------------------------------------------------------------------
TARGET_AVAILABILITY: float = 0.95  # A_g^min (system setting default_service_level overrides)
GUARD: float = 0.01  # guard of one percentage point, applied ONCE in J5 selection (§7.4 item 4)
CONTROLLER_ETA: float = 1.0
THETA_MIN: float = -2.0
THETA_MAX: float = 2.0

# --- Tier 2 grids (research.md §7.4) -------------------------------------------------------
# log-multiplier m_g from -0.7 to 2.0, step 0.05 (55 points)
M_GRID: List[float] = [round(float(x), 2) for x in np.arange(-0.70, 2.0000001, 0.05)]
KAPPA_GRID: List[float] = [0.5, 1.0, 1.5, 2.0]
VALIDATION_PERIODS: int = 21  # weeks of review periods used as validation window by J5
ALL_CLASSES: List[str] = ["AX", "AY", "AZ", "BX", "BY", "BZ", "CX", "CY", "CZ"]

# --- Route (c) -----------------------------------------------------------------------------
RESIDUAL_LOOKBACK_DAYS: int = 364  # max(0, o-364) <= s <= o-H (research.md §6.1)
MIN_RESIDUALS: int = 8  # below this the empirical quantile is not trusted -> labelled fallback
POINT_FORECAST_MODEL_PATTERN: str = "Ensemble%"  # strict F_hat source (P-24)
ROUTE_EMPIRICAL: str = "c"
ROUTE_FALLBACK: str = "c_fb"  # Gaussian fallback, honest label (R-06)

# --- Calendar ------------------------------------------------------------------------------
M5_DAY0: date = date(2011, 1, 29)  # M5 d_1 == day index 0


def date_to_day_index(d: date) -> int:
    """0-based M5 day index (d_1 -> 0)."""
    return (d - M5_DAY0).days


def day_index_to_date(idx: int) -> date:
    return M5_DAY0 + timedelta(days=int(idx))


# --- Demo convention (P-35 / N-11): ONE date for seed_demo, sync, quantile origins ----------
# sales_history covers 2016-04-25 .. 2016-05-22 (28 days), the simulated clock starts at the
# first day of that range. Quantile origins, theta warm start and review dates all derive from it.
DEMO_START_DATE: date = date(2016, 4, 25)
DEMO_STORE_ID: str = "CA_1"
DEMO_SELECTION_ID: str = "quarter_2016_Q2"
