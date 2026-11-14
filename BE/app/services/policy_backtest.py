"""
Vectorised numpy backtest of the (R, s, S) policy over validation reviews (research.md §7.2-§7.4).

Used by job J5 (``OptimizationService.refit_quarterly_policies``) to score every (m_g, kappa_g)
candidate with a REAL simulation instead of a closed-form estimate (R-10, N-07):

  review k (every R = 7 days, start of day):  IP = on_hand + on_order
      s_k = ceil(Q_hat_k * exp(m + theta)),   S_k = s_k + ceil(kappa * EOQ_k)
      if IP <= s_k: order S_k - IP, it arrives L = 3 days later
  daily: demand d_t served from on_hand, the remainder is LOST (lost-sales model, A3)
  costs (A3): holding h = 0.002 * price per unit per day on end-of-day stock,
              shortage b = 0.35 * price per lost unit, ordering c = 2 per order
  availability (§7.3 / §8.1, observed): a SKU-period (one review period of R days) is "available"
              when no day of it ended with on_hand = 0.

All candidates are simulated at once: state arrays have shape (n_candidates, n_items).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

from app.services import policy_config as pc


@dataclass
class BacktestResult:
    m: np.ndarray             # (C,)
    kappa: np.ndarray         # (C,)
    cost: np.ndarray          # (C,) total cost summed over items and periods
    holding: np.ndarray
    shortage: np.ndarray
    ordering: np.ndarray
    availability: np.ndarray  # (C,) share of available SKU-periods
    fill_rate: np.ndarray     # (C,)
    n_sku_periods: int


def eoq_units(mu_daily: np.ndarray, price: np.ndarray) -> np.ndarray:
    """EOQ = sqrt(2 c D / h_annual) with D = 365 mu and h_annual = 365 * 0.002 * price  (units)."""
    h_daily = np.maximum(pc.HOLDING_RATE_DAILY * np.asarray(price, dtype=float), 1e-9)
    return np.maximum(1.0, np.sqrt(2.0 * pc.ORDER_COST_C * np.maximum(mu_daily, 0.0) / h_daily))


def simulate_rss_candidates(
    daily_demand: np.ndarray,      # (n_items, K*R) actual demand, no NaN
    q_hat: np.ndarray,             # (n_items, K) Q_hat at the review of each period
    eoq: np.ndarray,               # (n_items, K) EOQ in units at each review
    price: np.ndarray,             # (n_items,)
    m_values: Sequence[float],
    kappa_values: Sequence[float],
    theta: float = 0.0,
    lead_time: int = pc.LEAD_TIME_DAYS,
    review_period: int = pc.REVIEW_PERIOD_DAYS,
    initial_on_hand: Optional[np.ndarray] = None,
) -> BacktestResult:
    """Simulate the Cartesian grid m x kappa. See module docstring for the dynamics."""
    n, T = daily_demand.shape
    K = q_hat.shape[1]
    R, L = int(review_period), int(lead_time)
    if T != K * R:
        raise ValueError(f"daily_demand has {T} days, expected K*R = {K * R}")
    price = np.asarray(price, dtype=float)
    grid_m = np.repeat(np.asarray(m_values, dtype=float), len(kappa_values))
    grid_k = np.tile(np.asarray(kappa_values, dtype=float), len(m_values))
    C = len(grid_m)
    mult = np.exp(grid_m + theta)[:, None]  # (C,1)

    h = (pc.HOLDING_RATE_DAILY * price)[None, :]
    b = (pc.STOCKOUT_PENALTY_RATE * price)[None, :]

    # every candidate starts from the same stock: the first review's s + EOQ for m = 0
    if initial_on_hand is None:
        initial_on_hand = np.ceil(q_hat[:, 0]) + np.ceil(eoq[:, 0])
    on_hand = np.tile(np.asarray(initial_on_hand, dtype=float)[None, :], (C, 1))
    # pipeline[i] = quantity arriving at the start of day (today + i)
    pipeline: List[np.ndarray] = [np.zeros((C, n)) for _ in range(L + 1)]

    hold = np.zeros(C)
    short = np.zeros(C)
    order = np.zeros(C)
    avail_periods = np.zeros(C)
    lost_units = np.zeros(C)
    demand_total = float(daily_demand.sum())

    for k in range(K):
        s_k = np.ceil(q_hat[:, k][None, :] * mult)                       # (C, n)
        S_k = s_k + np.ceil(grid_k[:, None] * eoq[:, k][None, :])
        ip = on_hand + sum(pipeline)
        qty = np.where(ip <= s_k, np.maximum(S_k - ip, 0.0), 0.0)
        order += (qty > 0).sum(axis=1) * pc.ORDER_COST_C
        pipeline[L] = pipeline[L] + qty
        stocked_out = np.zeros((C, n), dtype=bool)
        for r in range(R):
            on_hand = on_hand + pipeline[0]
            pipeline = pipeline[1:] + [np.zeros((C, n))]
            d = daily_demand[:, k * R + r][None, :]
            sold = np.minimum(on_hand, d)
            lost = d - sold
            on_hand = on_hand - sold
            stocked_out |= on_hand <= 0.0
            hold += (h * on_hand).sum(axis=1)
            short += (b * lost).sum(axis=1)
            lost_units += lost.sum(axis=1)
        avail_periods += (~stocked_out).sum(axis=1)

    return BacktestResult(
        m=grid_m, kappa=grid_k, cost=hold + short + order, holding=hold, shortage=short, ordering=order,
        availability=avail_periods / max(1, n * K),
        fill_rate=(1.0 - lost_units / demand_total) if demand_total > 0 else np.ones(C),
        n_sku_periods=n * K,
    )


def select_candidate(
    res: BacktestResult,
    target_availability: float,
    guard: float = pc.GUARD,
) -> Dict[str, Any]:
    """
    §7.4: minimum cost subject to availability >= target + guard (guard applied ONCE, here).
    If no candidate is feasible, return the one with the highest availability (ties: lower cost)
    and flag ``is_feasible = False``.
    """
    need = target_availability + guard
    feas = res.availability >= need
    if feas.any():
        idx = np.where(feas)[0]
        i = int(idx[np.argmin(res.cost[idx])])
        ok = True
    else:
        idx = np.where(res.availability >= res.availability.max() - 1e-12)[0]
        i = int(idx[np.argmin(res.cost[idx])])
        ok = False
    return {
        "m": float(res.m[i]), "kappa": float(res.kappa[i]), "cost": float(res.cost[i]),
        "availability": float(res.availability[i]), "fill_rate": float(res.fill_rate[i]),
        "is_feasible": bool(ok), "index": i,
    }
