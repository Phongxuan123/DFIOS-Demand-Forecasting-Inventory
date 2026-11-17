"""
Vectorised numpy backtest of the (R, s, S) policy over validation reviews (research.md §7.2-§7.4).

Used by job J5 (``OptimizationService.refit_quarterly_policies``) to score every (m_g, kappa_g)
candidate with a REAL simulation instead of a closed-form estimate (R-10, N-07). The dynamics follow the
teacher's reference simulator (``DFIOS/experiments/rss.py``, E10b; docs/teacher_map/00_INDEX.md §3, §12):

  day t (0-based inside the replayed segment):
      1. start of day: on_hand += arrivals of day t (an order placed at day u arrives at the start of u + L,
         BEFORE that day's review)
      2. review (t % R == 0, review k = t // R):
             IP  = on_hand + orders still in transit (placed within the last L - 1 days, arriving after today)
             s_k = ceil(Q_hat_k * exp(m + theta) - 1e-9),   S_k = s_k + ceil(kappa * EOQ_k - 1e-9)
             if IP < s_k (STRICT, G-02): order S_k - IP (no minimum quantity), it arrives at the start of t + L
      3. demand d_t served from on_hand, the remainder is LOST (lost-sales model, no backorders)
      4. costs (A3): holding h = 0.002 * price_t per unit on END-OF-DAY stock (price of that day when a daily
         price matrix is given), shortage b = 0.35 * price_t per lost unit, ordering c = 2 per order line
  service cycle (G-01): the cycle of review k covers days t_k + L .. t_k + L + R - 1 (the days the order of
  review k has to serve). A SKU fails the cycle when any of its days ENDS with on_hand <= 0 (stock-out signal;
  a lost sale always leaves on_hand = 0, so the lost-sales signal is contained in it). Only COMPLETE cycles
  (cycle end < end of the replayed segment) are scored; availability = share of available SKU-cycles.
  initial stock (G-03): when not given, round(mean of the 28 days before the segment * (L + R)) per SKU if that
  history is passed (``history_demand``); otherwise the legacy ceil(Q_hat_0) + ceil(EOQ_0).

All candidates are simulated at once: state arrays have shape (n_candidates, n_items).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

from app.services import policy_config as pc

CEIL_EPS = 1e-9          # teacher: ceil(x - 1e-9), avoids a spurious +1 from floating-point noise
INIT_STOCK_WINDOW = 28   # G-03: days of history used for the initial stock


@dataclass
class BacktestResult:
    m: np.ndarray             # (C,)
    kappa: np.ndarray         # (C,)
    cost: np.ndarray          # (C,) total cost summed over items and periods
    holding: np.ndarray
    shortage: np.ndarray
    ordering: np.ndarray
    availability: np.ndarray  # (C,) share of available SKU-cycles (complete cycles only; NaN when none)
    fill_rate: np.ndarray     # (C,)
    n_sku_periods: int        # n_items * number of complete service cycles
    orders: Optional[np.ndarray] = None      # (C,) number of order lines placed
    lost_units: Optional[np.ndarray] = None  # (C,)
    demand_units: float = 0.0
    n_cycles: int = 0                        # number of complete service cycles scored


def eoq_units(
    mu_daily: np.ndarray, price: np.ndarray,
    holding_rate: float = pc.HOLDING_RATE_DAILY, order_cost: float = pc.ORDER_COST_C,
) -> np.ndarray:
    """EOQ = sqrt(2 c D / h_annual) with D = 365 mu and h_annual = 365 * h * price  (units, >= 1)."""
    h_daily = np.maximum(float(holding_rate) * np.asarray(price, dtype=float), 1e-9)
    return np.maximum(1.0, np.sqrt(2.0 * float(order_cost) * np.maximum(mu_daily, 0.0) / h_daily))


def initial_stock_from_history(history_demand: np.ndarray, lead_time: int, review_period: int,
                               window: int = INIT_STOCK_WINDOW) -> np.ndarray:
    """G-03: round(mean of the last ``window`` days of sales * (L + R)) per SKU (NaN days ignored, all-NaN -> 0)."""
    hist = np.asarray(history_demand, dtype=float)
    if hist.ndim != 2 or hist.shape[1] == 0:
        raise ValueError("history_demand must be a non-empty (n_items, days) matrix")
    tail = hist[:, -int(window):]
    cnt = (~np.isnan(tail)).sum(axis=1)
    tot = np.where(np.isnan(tail), 0.0, tail).sum(axis=1)
    mu = np.where(cnt > 0, tot / np.maximum(cnt, 1), 0.0)
    return np.round(mu * (int(lead_time) + int(review_period)))


def complete_cycles(n_days: int, n_reviews: int, lead_time: int, review_period: int) -> int:
    """Number of reviews k whose service cycle [kR + L, kR + L + R - 1] ends strictly inside the segment."""
    L, R = int(lead_time), int(review_period)
    return int(sum(1 for k in range(n_reviews) if k * R + L + R - 1 < n_days))


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
    holding_rate: float = pc.HOLDING_RATE_DAILY,
    stockout_rate: float = pc.STOCKOUT_PENALTY_RATE,
    order_cost: float = pc.ORDER_COST_C,
    daily_price: Optional[np.ndarray] = None,     # (n_items, K*R) price of each day; defaults to ``price``
    history_demand: Optional[np.ndarray] = None,  # (n_items, >= 1) sales BEFORE the segment, for G-03
) -> BacktestResult:
    """Simulate the Cartesian grid m x kappa. See module docstring for the dynamics. The cost rates default to A3
    (h = 0.002, b = 0.35, c = 2); the what-if simulator (FR10) passes user-given rates."""
    n, T = daily_demand.shape
    K = q_hat.shape[1]
    R, L = int(review_period), int(lead_time)
    if T != K * R:
        raise ValueError(f"daily_demand has {T} days, expected K*R = {K * R}")
    if L < 0 or R < 1:
        raise ValueError("lead_time must be >= 0 and review_period >= 1")
    price = np.asarray(price, dtype=float)
    if daily_price is None:
        p_day = np.broadcast_to(price[:, None], (n, T))
    else:
        p_day = np.asarray(daily_price, dtype=float)
        if p_day.shape != (n, T):
            raise ValueError(f"daily_price must have shape {(n, T)}")
    grid_m = np.repeat(np.asarray(m_values, dtype=float), len(kappa_values))
    grid_k = np.tile(np.asarray(kappa_values, dtype=float), len(m_values))
    C = len(grid_m)
    mult = np.exp(grid_m + theta)[:, None]  # (C,1)

    if initial_on_hand is None:
        if history_demand is not None:
            initial_on_hand = initial_stock_from_history(history_demand, L, R)
        else:
            # legacy (no history given): the first review's s + EOQ for m = 0
            initial_on_hand = np.ceil(q_hat[:, 0]) + np.ceil(eoq[:, 0])
    on_hand = np.tile(np.asarray(initial_on_hand, dtype=float)[None, :], (C, 1))
    # pipe[j] = quantity arriving at the start of day (t + 1 + j), j = 0 .. L-1, seen after day t's arrivals
    pipe: List[np.ndarray] = [np.zeros((C, n)) for _ in range(max(L, 1))]

    n_cyc = complete_cycles(T, K, L, R)
    hold = np.zeros(C)
    short = np.zeros(C)
    order = np.zeros(C)
    n_orders = np.zeros(C)
    avail_cycles = np.zeros(C)
    lost_units = np.zeros(C)
    demand_total = float(daily_demand.sum())
    cyc_out = np.zeros((C, n), dtype=bool)   # stock-out flag of the cycle currently observed

    for t in range(T):
        # 1. arrivals at the start of day t (before the review)
        if L >= 1 and t > 0:
            on_hand = on_hand + pipe[0]
            pipe = pipe[1:] + [np.zeros((C, n))]
        # 2. review: IP = on_hand + everything still in transit (arrives after today)
        if t % R == 0:
            k = t // R
            s_k = np.ceil(q_hat[:, k][None, :] * mult - CEIL_EPS)                     # (C, n)
            S_k = s_k + np.ceil(grid_k[:, None] * eoq[:, k][None, :] - CEIL_EPS)
            ip = on_hand + sum(pipe) if L >= 1 else on_hand
            qty = np.where(ip < s_k, np.maximum(S_k - ip, 0.0), 0.0)
            placed = (qty > 0).sum(axis=1)
            n_orders += placed
            order += placed * float(order_cost)
            if L == 0:
                on_hand = on_hand + qty
            else:
                pipe[L - 1] = pipe[L - 1] + qty
        # 3. lost-sales demand
        d = daily_demand[:, t][None, :]
        sold = np.minimum(on_hand, d)
        lost = d - sold
        on_hand = on_hand - sold
        p_t = p_day[:, t][None, :]
        hold += (float(holding_rate) * p_t * on_hand).sum(axis=1)
        short += (float(stockout_rate) * p_t * lost).sum(axis=1)
        lost_units += lost.sum(axis=1)
        # 4. service cycle of review kc = (t - L) // R  (days t_kc + L .. t_kc + L + R - 1)
        if t >= L and (t - L) // R < n_cyc:
            cyc_out |= on_hand <= 0.0
            if (t - L) % R == R - 1:      # last day of cycle kc
                avail_cycles += (~cyc_out).sum(axis=1)
                cyc_out[:] = False

    n_periods = n * n_cyc
    return BacktestResult(
        m=grid_m, kappa=grid_k, cost=hold + short + order, holding=hold, shortage=short, ordering=order,
        availability=(avail_cycles / n_periods) if n_periods else np.full(C, np.nan),
        fill_rate=(1.0 - lost_units / demand_total) if demand_total > 0 else np.ones(C),
        n_sku_periods=n_periods,
        orders=n_orders, lost_units=lost_units, demand_units=demand_total, n_cycles=n_cyc,
    )


def select_candidate(
    res: BacktestResult,
    target_availability: float,
    guard: float = pc.GUARD,
    mask: Optional[np.ndarray] = None,
) -> Dict[str, Any]:
    """
    §7.4: minimum cost subject to availability >= target + guard (guard applied ONCE, here).
    If no candidate is feasible, return the one with the highest availability (ties: lower cost)
    and flag ``is_feasible = False``. A candidate without any complete cycle (NaN availability) is never feasible.
    """
    need = target_availability + guard
    allowed = np.ones(len(res.availability), dtype=bool) if mask is None else np.asarray(mask, dtype=bool)
    if not allowed.any():
        raise ValueError("select_candidate: empty candidate mask")
    av = np.nan_to_num(np.asarray(res.availability, dtype=float), nan=-1.0)
    feas = (av >= need) & allowed
    if feas.any():
        idx = np.where(feas)[0]
        i = int(idx[np.argmin(res.cost[idx])])
        ok = True
    else:
        amax = av[allowed].max()
        idx = np.where((av >= amax - 1e-12) & allowed)[0]
        i = int(idx[np.argmin(res.cost[idx])])
        ok = False
    return {
        "m": float(res.m[i]), "kappa": float(res.kappa[i]), "cost": float(res.cost[i]),
        "availability": float(res.availability[i]), "fill_rate": float(res.fill_rate[i]),
        "is_feasible": bool(ok), "index": i,
    }
