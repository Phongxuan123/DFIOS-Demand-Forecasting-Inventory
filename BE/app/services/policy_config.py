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
TARGET_AVAILABILITY: float = 0.95  # A_g^min, the service commitment (system setting default_service_level overrides)
GUARD: float = 0.01  # one percentage point; teacher guard 0.96 = 0.95 + 0.01 (applied ONCE, in J5 selection)
# G-09: J5 keeps candidates with class availability >= 0.96 on the selection window (teacher E10b ``choose``).
SELECTION_GUARD_AVAILABILITY: float = 0.96

# --- C3-OUT (teacher E9c, one-sided; docs/teacher_map/00_INDEX.md sec. 4, 13) -------------
#   theta <- clip(theta + eta * (e_{g,k-d} - (1 - setpoint)), THETA_MIN, THETA_MAX),  theta_0 = 0,
#   d = ceil((L + R) / R), e = stock-out share of the class in cycle k-d, NO boundary-convention substitution.
#   theta is ADDED on top of the J5 grid m_g:  s = ceil(Q_hat(0.95) * exp(m_g + theta_g) - 1e-9).
CONTROLLER_ETA: float = 1.0
C3_SETPOINT: float = 0.96
THETA_INIT: float = 0.0
THETA_MIN: float = 0.0
THETA_MAX: float = 2.0
C3_VARIANT: str = "one_sided"  # default, teacher-aligned
# ABLATION ONLY (never the default): the old two-sided range theta in [-2, 2] (teacher's rejected C3-2S).
C3_VARIANT_TWO_SIDED: str = "two_sided"
THETA_MIN_TWO_SIDED: float = -2.0

# --- Tier 2 grids (teacher E10b; G-05..G-10) ------------------------------------------------
# log-multiplier m_g from -0.7 to 2.0, step 0.1 (28 points)
M_GRID: List[float] = [float(x) + 0.0 for x in np.round(np.arange(-0.7, 2.0001, 0.1), 2)]
KAPPA_GRID: List[float] = [0.0, 0.5, 1.0, 1.5, 2.0]  # batch = ceil(kappa * EOQ - 1e-9); kappa = 0 -> no batch
SELECTION_WINDOW_DAYS: int = 182  # 26 weeks scored by J5, ending at the refit day
REFIT_PERIOD_DAYS: int = 91       # J5 refit every 91 days (teacher quarters TEST + 91 j)
EOQ_MEAN_WINDOW_DAYS: int = 56    # EOQ mean demand = mean ACTUAL daily sales of the 56 days before the review
INIT_STOCK_WINDOW_DAYS: int = 28  # initial stock = round(mean 28 days * (L + R))
QUANTILE_TAU: float = 0.95        # J5 reads Q_hat at tau = 0.95 (teacher level index 10)
# J5 search modes: "m_grid" = teacher default (full m x kappa grid; C3 theta is added on top of m);
# "kappa_only" = ABLATION (m forced to 0, theta alone carries the protection level; the old DFIOS default).
J5_SEARCH_MODE_DEFAULT: str = "m_grid"
J5_SEARCH_MODE_ABLATION: str = "kappa_only"
ALL_CLASSES: List[str] = ["AX", "AY", "AZ", "BX", "BY", "BZ", "CX", "CY", "CZ"]

# --- Route (c) -----------------------------------------------------------------------------
RESIDUAL_LOOKBACK_DAYS: int = 364  # max(0, o-364) <= s <= o-H (research.md §6.1)
MIN_RESIDUALS: int = 8  # Gaussian-fallback threshold, only used when GAUSSIAN_FALLBACK_ENABLED
POINT_FORECAST_MODEL_PATTERN: str = "Ensemble%"  # strict F_hat source (P-24)
ROUTE_EMPIRICAL: str = "c"
ROUTE_FALLBACK: str = "c_fb"  # Gaussian fallback, honest label (R-06)
# P2 sandbox: window quantiles imported from the teacher's ensemble Q_H10 (scripts/load_teacher_data.py). When rows
# with this route exist for a store, J3 reuses them as-is and J5 scores its candidates on them (no route-(c) rebuild).
ROUTE_TEACHER: str = "teacher"
# Teacher route (c): Q_hat(tau) = max(0, F_hat + empirical tau-quantile of the window residuals), nothing else.
# The two DFIOS extras are OFF by default (G-26 / G-27) and can be switched on (module flag or per call):
#   QUANTILE_FLOOR_ENABLED    -> Q_hat >= QUANTILE_FLOOR_UNITS when tau >= 0.90 and F_hat > 0 (old DFIOS rule)
#   GAUSSIAN_FALLBACK_ENABLED -> fewer than MIN_RESIDUALS residuals: F_hat + z_tau * sigma * sqrt(H) (label c_fb)
# With the fallback OFF any number >= 1 of residuals gives the empirical quantile; with NO residual at all the
# residual quantile is 0 (Q_hat = max(0, F_hat)). Off-grid tau values are linearly interpolated between the stored
# levels (G-28).
QUANTILE_FLOOR_ENABLED: bool = False
QUANTILE_FLOOR_UNITS: float = 1.0
GAUSSIAN_FALLBACK_ENABLED: bool = False

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
