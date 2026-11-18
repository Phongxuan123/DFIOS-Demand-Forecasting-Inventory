"""Pure-numpy replay of the teacher's periodic-review (R, s, S) experiments E10b and E9c.

This module re-implements, from the written notes (docs/teacher_map), the simulator and the
class-wise constrained parameter selection that produced the teacher's Table 17
(E10b, ``REFIT-RSS-EOQ-G``) and the one-sided C3-OUT experiment E9c (``REFIT-RSS-C3``).
No teacher code is imported; the teacher's data folder is only *read* at runtime
(``numpy.load(..., mmap_mode="r")`` and one parquet metadata file) and nothing is ever
written there.

Model (all day indices are 0-based, day 0 = 2011-01-29)
------------------------------------------------------
* Simulation runs continuously from ``VAL_START`` (1395) to ``T`` (1941, exclusive).
* Start of day t: pipeline arrivals for t are added to on-hand stock.
* Review days are ``VAL_START + k*R``. At review k:
  ``s = ceil(Q[k] * exp(m_g + theta_g) - 1e-9)`` where ``Q[k]`` is the 0.95 quantile of the
  (L+R)-day demand forecast at origin ``t_k``; ``IP = on_hand + sum(pipeline[t+1 .. t+L-1])``;
  an order of ``s + batch - IP`` is placed **only when IP < s** (strict) and arrives at t+L.
* Batch: ``ceil(kappa_g * EOQ - 1e-9)`` with ``EOQ = sqrt(2c*mu/(h*p_t))``, ``mu`` = mean
  sales of the 56 days before the review (E10b) - or ``ceil(kappa_g * mu_R - 1e-9)`` with
  ``mu_R = R * mean of the 28 days before the review`` (E8/E9c batch rule).
* Unmet demand is lost. Holding is charged on end-of-day stock at that day's price.
  Costs: ``h*price`` per unit-day, ``b*price`` per lost unit, ``c`` per order line.
* Service cycle of review k = days ``t_k+L .. t_k+L+R-1``; the cycle fails for a SKU if
  end-of-day on-hand is ``<= 0`` on any of those days (the "stockout" signal).
  Class CSL (availability) = 1 - mean over complete cycles of the share of failing SKUs.
* Initial stock = ``round(mean(y[VAL-28:VAL]) * (L+R))``; pipeline empty.
* Candidates: every (m, kappa) on the grid is simulated once over the whole horizon with the
  same (m, kappa) for all classes, then scored on each selection window
  ``(max(VAL, a-182), a)`` for quarter starts ``a = TEST + 91*j``. For every class
  :func:`choose` picks the cheapest candidate with CSL >= guard (0.96), otherwise the one with
  the smallest shortfall and then the lowest cost.
* ``RSS-EOQ-G`` applies the window-0 (validation) choice to all reviews; ``REFIT-*`` policies
  start with it and switch to the quarter's choice for reviews ``>= a``.
* ``REFIT-RSS-C3`` reuses the ``REFIT-RSS-G`` schedule (chosen *without* C3) and re-simulates
  with one-sided C3-OUT: ``theta_0 = 0`` at VAL; at review k (if k-d >= 0, d = ceil((L+R)/R))
  ``theta = clip(theta + eta*(e_{k-d} - (1-setpoint)), lo, hi)`` with ``e`` the class stockout
  share of cycle k-d; theta is added to m.

Store subsets
-------------
``load_teacher_inputs(stores=["CA_1"])`` keeps only the rows of those stores. By default the
teacher's pooled 3-store labels (``meta.abcxyz_merged``) are kept (``labels="teacher"``); with
``labels="merge_small"`` the raw ``abcxyz`` labels of the subset are re-merged with the
teacher's ``merge_small`` rule (classes with < 15 SKUs merged into the nearest class).
Either way, numbers for a subset (e.g. CA_1 only: 2,943 SKUs, class CX has 3 SKUs) will NOT
equal the teacher's 3-store totals: the selection is re-run on the subset's class costs/CSL.
"""
from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field
from functools import cached_property
from typing import Iterable, Sequence

import numpy as np

DEFAULT_TEACHER_DIR = r"C:\DATN\26FA_SET490_Inventory"

POLICIES = ("RSS-EOQ-G", "REFIT-RSS-EOQ-G", "REFIT-RSS-G", "REFIT-RSS-C3")
_EOQ_POLICIES = ("RSS-EOQ-G", "REFIT-RSS-EOQ-G")

QUANTILE_LEVELS = (0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.925, 0.95, 0.96,
                   0.97, 0.975, 0.98, 0.985, 0.99, 0.995, 0.999)

_ABC = "ABC"
_XYZ = "XYZ"


def teacher_dir_default() -> str:
    """Teacher folder from env ``TEACHER_DIR`` (default ``C:\\DATN\\26FA_SET490_Inventory``)."""
    return os.environ.get("TEACHER_DIR", DEFAULT_TEACHER_DIR)


def _m_grid() -> tuple[float, ...]:
    return tuple(float(x) + 0.0 for x in np.round(np.arange(-0.7, 2.0001, 0.1), 2))


@dataclass(frozen=True)
class ReplayConfig:
    """Constants of the replay. Defaults reproduce E10b / E9c of the teacher."""

    L: int = 3
    R: int = 7
    VAL_START: int = 1395
    TEST_START: int = 1577
    T: int = 1941
    m_grid: tuple[float, ...] = field(default_factory=_m_grid)  # -0.7..2.0 step 0.1 (28)
    kappa_grid_eoq: tuple[float, ...] = (0.0, 0.5, 1.0, 1.5, 2.0)  # E10b (EOQ batch)
    kappa_grid_mu: tuple[float, ...] = (0.0, 0.5, 1.0, 2.0, 3.0)  # E8/E9c (k * mu_R batch)
    guard: float = 0.96
    h: float = 0.002
    b: float = 0.35
    c: float = 2.0
    eoq_window: int = 56
    mu_window: int = 28
    init_window: int = 28
    quarter_len: int = 91
    n_quarters: int = 4
    selection_lookback: int = 182
    # one-sided C3-OUT (E9c)
    c3_eta: float = 1.0
    c3_setpoint: float = 0.96
    c3_lo: float = 0.0
    c3_hi: float = 2.0
    level_index: int = 10  # QUANTILE_LEVELS[10] == 0.95

    @property
    def review_days(self) -> np.ndarray:
        return np.arange(self.VAL_START, self.T, self.R)

    @property
    def c3_delay(self) -> int:
        return int(math.ceil((self.L + self.R) / self.R))

    @property
    def quarters(self) -> list[tuple[int, int]]:
        q = self.quarter_len
        return [(self.TEST_START + q * j, self.TEST_START + q * (j + 1)) for j in range(self.n_quarters)]

    @property
    def selection_windows(self) -> list[tuple[int, int]]:
        return [(max(self.VAL_START, a - self.selection_lookback), a) for a, _ in self.quarters]

    def kappa_grid(self, policy: str) -> tuple[float, ...]:
        return self.kappa_grid_eoq if policy in _EOQ_POLICIES else self.kappa_grid_mu


@dataclass
class ReplayInputs:
    """Arrays the replay needs. Rows are SKUs (item x store), columns are days 0..T-1."""

    y: np.ndarray  # (n, T) float64 sales
    price: np.ndarray  # (n, T) daily price
    groups: np.ndarray  # (n,) int class id (index into class_names)
    class_names: list[str]
    q: np.ndarray  # (K, n) float64: quantile of the (L+R)-day demand at each review day
    review_days: np.ndarray  # (K,)
    L: int
    R: int
    store_id: np.ndarray | None = None
    item_id: np.ndarray | None = None
    model: str = "custom"

    @property
    def n(self) -> int:
        return int(self.y.shape[0])

    @property
    def G(self) -> int:
        return len(self.class_names)

    @cached_property
    def class_sizes(self) -> np.ndarray:
        return np.bincount(self.groups, minlength=self.G).astype(float)

    @cached_property
    def onehot(self) -> np.ndarray:
        oh = np.zeros((self.n, self.G))
        oh[np.arange(self.n), self.groups] = 1.0
        return oh

    def daily(self, val_start: int, t_end: int) -> tuple[np.ndarray, np.ndarray]:
        """Day-major (D, n) contiguous copies of y and price over [val_start, t_end)."""
        key = (val_start, t_end)
        cache = self.__dict__.setdefault("_daily_cache", {})
        if key not in cache:
            cache[key] = (np.ascontiguousarray(self.y[:, val_start:t_end].T, dtype=np.float64),
                          np.ascontiguousarray(self.price[:, val_start:t_end].T, dtype=np.float64))
        return cache[key]


@dataclass
class SimTrace:
    """Raw output of one simulation over [VAL_START, T)."""

    hold_value: np.ndarray  # (D, G) end-of-day stock * price per class
    lost_value: np.ndarray  # (D, G) lost units * price per class
    orders: np.ndarray  # (K, G) number of order lines per review and class
    stockout: np.ndarray  # (K, n) bool: SKU had end-of-day on-hand <= 0 in cycle k
    lost_units: np.ndarray  # (D,)
    demand_units: np.ndarray  # (D,)
    theta: np.ndarray  # (K, G) C3 state used at each review (zeros without C3)


# --------------------------------------------------------------------------- classes
def merge_small(labels: Sequence[str], min_size: int = 15) -> np.ndarray:
    """Teacher's ``merge_small``: repeatedly take the smallest class with < ``min_size`` members
    and merge it into the class with the smallest Manhattan distance on the (A,B,C)x(X,Y,Z)
    grid; ties go to the larger class (then alphabetical). The target keeps its name."""
    lab = np.asarray(labels).astype(str).copy()

    def pos(name: str) -> tuple[int, int]:
        if len(name) != 2 or name[0] not in _ABC or name[1] not in _XYZ:
            raise ValueError(f"merge_small expects ABC x XYZ labels, got {name!r}")
        return _ABC.index(name[0]), _XYZ.index(name[1])

    while True:
        names, counts = np.unique(lab, return_counts=True)
        if len(names) <= 1:
            return lab
        small = [(int(c), str(n)) for n, c in zip(names, counts) if c < min_size]
        if not small:
            return lab
        _, src = min(small)
        sp = pos(src)
        cands = []
        for n_, c_ in zip(names, counts):
            if n_ == src:
                continue
            tp = pos(str(n_))
            cands.append((abs(sp[0] - tp[0]) + abs(sp[1] - tp[1]), -int(c_), str(n_)))
        dst = min(cands)[2]
        lab[lab == src] = dst


# --------------------------------------------------------------------------- building blocks
def initial_stock(y: np.ndarray, cfg: ReplayConfig) -> np.ndarray:
    """``round(mean(y[:, VAL-28:VAL]) * (L+R))``."""
    w = y[:, cfg.VAL_START - cfg.init_window:cfg.VAL_START]
    return np.round(np.asarray(w, dtype=np.float64).mean(1) * (cfg.L + cfg.R))


def _trailing_mean(y: np.ndarray, review_days: np.ndarray, window: int) -> np.ndarray:
    """(K, n) mean of y over the ``window`` days strictly before each review day."""
    out = np.empty((len(review_days), y.shape[0]))
    for k, t in enumerate(review_days):
        a = max(int(t) - window, 0)
        out[k] = np.asarray(y[:, a:t], dtype=np.float64).sum(1) / max(1, int(t) - a)
    return out


def eoq_base(y: np.ndarray, price: np.ndarray, review_days: np.ndarray, cfg: ReplayConfig) -> np.ndarray:
    """(K, n) EOQ = sqrt(2c*mu/(h*p_t)), mu = 56-day trailing mean; no rounding, no floor."""
    mu = _trailing_mean(y, review_days, cfg.eoq_window)
    p = np.asarray(price[:, review_days], dtype=np.float64).T
    with np.errstate(divide="ignore", invalid="ignore"):
        eoq = np.sqrt(2.0 * cfg.c * mu / (cfg.h * p))
    return np.where(np.isfinite(eoq), eoq, 0.0)  # only matters for zero prices (none in M5)


def mu_r_base(y: np.ndarray, review_days: np.ndarray, cfg: ReplayConfig) -> np.ndarray:
    """(K, n) mu_R = R * 28-day trailing mean (E8/E9c batch base)."""
    return _trailing_mean(y, review_days, cfg.mu_window) * cfg.R


def batch_base_for(inputs: ReplayInputs, cfg: ReplayConfig, policy: str) -> np.ndarray:
    if policy in _EOQ_POLICIES:
        return eoq_base(inputs.y, inputs.price, inputs.review_days, cfg)
    return mu_r_base(inputs.y, inputs.review_days, cfg)


def c3_update(theta: np.ndarray, e: np.ndarray, cfg: ReplayConfig) -> np.ndarray:
    """One-sided C3-OUT step: clip(theta + eta*(e - (1-setpoint)), lo, hi)."""
    return np.clip(theta + cfg.c3_eta * (e - (1.0 - cfg.c3_setpoint)), cfg.c3_lo, cfg.c3_hi)


def cycle_days(review_day: int, cfg: ReplayConfig) -> range:
    """Service-cycle days of a review: t+L .. t+L+R-1."""
    return range(review_day + cfg.L, review_day + cfg.L + cfg.R)


def choose(costs: np.ndarray, svc: np.ndarray, guard: float) -> int:
    """Cheapest candidate with svc >= guard; else smallest shortfall, then lowest cost."""
    costs = np.asarray(costs, dtype=float)
    short = np.maximum(guard - np.asarray(svc, dtype=float), 0.0)
    valid = np.flatnonzero(short <= 1e-12)
    if len(valid):
        return int(valid[np.argmin(costs[valid])])
    return int(min(range(len(costs)), key=lambda j: (short[j], costs[j])))


# --------------------------------------------------------------------------- simulator
def simulate(inputs: ReplayInputs, cfg: ReplayConfig, mult: np.ndarray, kappa: np.ndarray,
             batch_base: np.ndarray, c3: bool = False, init: np.ndarray | None = None) -> SimTrace:
    """Simulate (R, s, S) from VAL_START to T. ``mult``/``kappa`` are (K, G) class schedules."""
    L, R, V, T = cfg.L, cfg.R, cfg.VAL_START, cfg.T
    if (inputs.L, inputs.R) != (L, R):
        raise ValueError("inputs were loaded for a different (L, R) than cfg")
    rd = inputs.review_days
    K, n, G, groups = len(rd), inputs.n, inputs.G, inputs.groups
    D = T - V
    yd, pd_ = inputs.daily(V, T)
    gsize = inputs.class_sizes
    oh = initial_stock(inputs.y, cfg) if init is None else np.array(init, dtype=np.float64)
    pipe = np.zeros((D + L + 1, n))
    theta = np.zeros(G)
    dly = cfg.c3_delay
    hv = np.zeros((D, G))
    lv = np.zeros((D, G))
    lu = np.zeros(D)
    du = np.zeros(D)
    ords = np.zeros((K, G))
    Z = np.zeros((K, n), dtype=bool)
    thetas = np.zeros((K, G))
    for rel in range(D):
        oh += pipe[rel]
        if rel % R == 0:
            k = rel // R
            if c3 and k - dly >= 0:
                e = np.bincount(groups, weights=Z[k - dly].astype(float), minlength=G) / gsize
                theta = c3_update(theta, e, cfg)
            thetas[k] = theta
            s = np.ceil(inputs.q[k] * np.exp((mult[k] + theta)[groups]) - 1e-9)
            batch = np.ceil(kappa[k][groups] * batch_base[k] - 1e-9)
            ip = oh + pipe[rel + 1:rel + L].sum(0)
            qty = np.maximum(np.where(ip < s, s + batch - ip, 0.0), 0.0)
            ords[k] = np.bincount(groups, weights=(qty > 0).astype(float), minlength=G)
            pipe[rel + L] += qty
        dem = yd[rel]
        sales = np.minimum(oh, dem)
        lost = dem - sales
        oh -= sales
        p = pd_[rel]
        hv[rel] = np.bincount(groups, weights=oh * p, minlength=G)
        lv[rel] = np.bincount(groups, weights=lost * p, minlength=G)
        lu[rel] = lost.sum()
        du[rel] = dem.sum()
        if rel >= L:
            kc = (rel - L) // R
            if kc < K:
                Z[kc] |= oh <= 0
    return SimTrace(hv, lv, ords, Z, lu, du, thetas)


def window_stats(trace: SimTrace, inputs: ReplayInputs, cfg: ReplayConfig, a: int, b: int):
    """Class costs (G,), class CSL (G,), number of complete cycles in [a, b)."""
    rd = inputs.review_days
    days = slice(a - cfg.VAL_START, b - cfg.VAL_START)
    in_seg = (rd >= a) & (rd < b)
    cyc = in_seg & (rd + cfg.L + cfg.R - 1 < min(b, cfg.T))
    cost = (cfg.h * trace.hold_value[days].sum(0) + cfg.b * trace.lost_value[days].sum(0)
            + cfg.c * trace.orders[in_seg].sum(0))
    nc = int(cyc.sum())
    if nc == 0:
        return cost, np.full(inputs.G, np.nan), 0
    ev = (trace.stockout[cyc].astype(float) @ inputs.onehot) / inputs.class_sizes
    return cost, 1.0 - ev.mean(0), nc


def segment_summary(trace: SimTrace, inputs: ReplayInputs, cfg: ReplayConfig, a: int, b: int) -> dict:
    rd = inputs.review_days
    days = slice(a - cfg.VAL_START, b - cfg.VAL_START)
    seg = (rd >= a) & (rd < b)
    hold = float(cfg.h * trace.hold_value[days].sum())
    lost = float(cfg.b * trace.lost_value[days].sum())
    n_orders = int(round(trace.orders[seg].sum()))
    ordering = float(cfg.c * n_orders)
    _, csl, nc = window_stats(trace, inputs, cfg, a, b)
    dem = trace.demand_units[days].sum()
    return {
        "segment": [int(a), int(b)],
        "cost": hold + lost + ordering,
        "holding": hold,
        "lost": lost,
        "ordering": ordering,
        "orders": n_orders,
        "fill": float(1.0 - trace.lost_units[days].sum() / dem) if dem > 0 else float("nan"),
        "n_cycles": nc,
        "class_csl": {name: float(v) for name, v in zip(inputs.class_names, csl)},
        "min_class_csl": float(np.nanmin(csl)) if nc else float("nan"),
    }


# --------------------------------------------------------------------------- selection
@dataclass
class CandidateStats:
    keys: list[tuple[float, float]]
    costs: np.ndarray  # (n_keys, n_windows, G)
    csl: np.ndarray  # (n_keys, n_windows, G)
    batch_rule: str


def evaluate_candidates(inputs: ReplayInputs, cfg: ReplayConfig, policy: str,
                        batch_base: np.ndarray | None = None, progress=None) -> CandidateStats:
    """Simulate every (m, kappa) on the grid once and score it on each selection window."""
    if batch_base is None:
        batch_base = batch_base_for(inputs, cfg, policy)
    keys = [(m, kv) for m in cfg.m_grid for kv in cfg.kappa_grid(policy)]
    K, G = len(inputs.review_days), inputs.G
    wins = cfg.selection_windows
    costs = np.zeros((len(keys), len(wins), G))
    csl = np.zeros((len(keys), len(wins), G))
    for i, (m, kv) in enumerate(keys):
        tr = simulate(inputs, cfg, np.full((K, G), m), np.full((K, G), kv), batch_base)
        for w, (a, b) in enumerate(wins):
            costs[i, w], csl[i, w], _ = window_stats(tr, inputs, cfg, a, b)
        if progress is not None:
            progress(i + 1, len(keys))
    return CandidateStats(keys, costs, csl, "eoq" if policy in _EOQ_POLICIES else "mu_r")


def select_per_window(stats: CandidateStats, cfg: ReplayConfig) -> list[dict]:
    out = []
    for w in range(stats.costs.shape[1]):
        idx = [choose(stats.costs[:, w, g], stats.csl[:, w, g], cfg.guard)
               for g in range(stats.costs.shape[2])]
        feas = bool(all(stats.csl[j, w, g] >= cfg.guard - 1e-12 for g, j in enumerate(idx)))
        out.append({"m": [stats.keys[j][0] for j in idx],
                    "kappa": [float(stats.keys[j][1]) for j in idx],
                    "feasible": feas})
    return out


def build_schedule(chosen: list[dict], inputs: ReplayInputs, cfg: ReplayConfig, refit: bool):
    """(K, G) mult/kappa arrays + teacher-style schedule list."""
    rd = inputs.review_days
    K, G = len(rd), inputs.G
    mult = np.tile(np.asarray(chosen[0]["m"], dtype=float), (K, 1))
    kap = np.tile(np.asarray(chosen[0]["kappa"], dtype=float), (K, 1))
    schedule = [{"start": int(cfg.VAL_START), **chosen[0]}]
    if refit:
        for w, (a, _) in enumerate(cfg.quarters):
            mask = rd >= a
            mult[mask] = chosen[w]["m"]
            kap[mask] = chosen[w]["kappa"]
            lo, hi = cfg.selection_windows[w]
            schedule.append({"start": int(a), "window": [int(lo), int(hi)], **chosen[w]})
    assert mult.shape == (K, G)
    return mult, kap, schedule


# --------------------------------------------------------------------------- top level
def replay(inputs: ReplayInputs, cfg: ReplayConfig | None = None, policy: str = "REFIT-RSS-EOQ-G",
           candidate_stats: CandidateStats | None = None, progress=None) -> dict:
    """Run one policy and return test-segment metrics + selection schedule.

    ``candidate_stats`` (from :func:`evaluate_candidates`, same batch rule) can be passed to
    skip the 140-candidate grid, e.g. to share it between ``REFIT-RSS-G`` and ``REFIT-RSS-C3``.
    The returned dict has a private key ``"_candidates"`` holding the CandidateStats used.
    """
    cfg = cfg or ReplayConfig(L=inputs.L, R=inputs.R)
    if policy not in POLICIES:
        raise ValueError(f"policy must be one of {POLICIES}")
    base = batch_base_for(inputs, cfg, policy)
    rule = "eoq" if policy in _EOQ_POLICIES else "mu_r"
    if candidate_stats is None or candidate_stats.batch_rule != rule:
        candidate_stats = evaluate_candidates(inputs, cfg, policy, base, progress)
    chosen = select_per_window(candidate_stats, cfg)
    refit = policy != "RSS-EOQ-G"
    mult, kap, schedule = build_schedule(chosen, inputs, cfg, refit)
    c3 = policy == "REFIT-RSS-C3"
    trace = simulate(inputs, cfg, mult, kap, base, c3=c3)
    res = segment_summary(trace, inputs, cfg, cfg.TEST_START, cfg.T)
    res.update({
        "policy": policy,
        "model": inputs.model,
        "L": cfg.L,
        "R": cfg.R,
        "n_skus": inputs.n,
        "stores": sorted({str(s) for s in inputs.store_id}) if inputs.store_id is not None else None,
        "classes": list(inputs.class_names),
        "class_sizes": {nm: int(v) for nm, v in zip(inputs.class_names, inputs.class_sizes)},
        "batch_rule": rule,
        "selection": {"policy": policy, "schedule": schedule, "model": inputs.model},
        "validation": {k: v for k, v in segment_summary(trace, inputs, cfg, cfg.VAL_START, cfg.TEST_START).items()
                       if k in ("cost", "fill", "min_class_csl", "orders")},
    })
    if c3:
        res["c3"] = {"eta": cfg.c3_eta, "setpoint": cfg.c3_setpoint, "lo": cfg.c3_lo, "hi": cfg.c3_hi,
                     "delay": cfg.c3_delay,
                     "theta_last": {nm: float(v) for nm, v in zip(inputs.class_names, trace.theta[-1])}}
    res["_candidates"] = candidate_stats
    return res


def public_result(res: dict) -> dict:
    """Drop private (non-JSON) keys from a :func:`replay` result."""
    return {k: v for k, v in res.items() if not k.startswith("_")}


# --------------------------------------------------------------------------- teacher data
def _forecast_dir(teacher_dir: str, model: str) -> str:
    for sub in (("DFIOS", "results", "forecasts"), ("c3out_experiments", "results", "m5", "forecasts"),
                ("c3out_experiments", "results", "revision", "forecasts")):
        d = os.path.join(teacher_dir, *sub, model)
        if os.path.isdir(d):
            return d
    raise FileNotFoundError(f"no forecast folder for model {model!r} under {teacher_dir}")


def load_teacher_inputs(teacher_dir: str | None = None, model: str = "ensemble",
                        stores: Iterable[str] | None = None, cfg: ReplayConfig | None = None,
                        labels: str = "teacher") -> ReplayInputs:
    """Read the teacher's prepared M5 arrays and the (L+R)-window quantile forecasts (read-only).

    * ``y``, ``price``: ``c3out_experiments/data/m5_prepared/{y,price}.npy`` (mmap, rows kept as float64).
    * groups: ``meta.abcxyz_merged`` (``labels="teacher"``) or ``merge_small(meta.abcxyz)``
      recomputed on the kept rows (``labels="merge_small"``).
    * ``q``: ``Q_H{L+R}.npy[origin, sku, level_index]`` at the review origins ``VAL, VAL+R, ...``;
      the file's ``origins.npy`` must contain every expected origin.
    """
    import pandas as pd  # parquet metadata only

    cfg = cfg or ReplayConfig()
    teacher_dir = teacher_dir or teacher_dir_default()
    prep = os.path.join(teacher_dir, "c3out_experiments", "data", "m5_prepared")
    with open(os.path.join(prep, "info.json"), encoding="utf-8") as f:
        info = json.load(f)
    if (info["VAL_START"], info["TEST_START"], info["T_END"]) != (cfg.VAL_START, cfg.TEST_START, cfg.T):
        raise ValueError("ReplayConfig VAL_START/TEST_START/T differ from the teacher's info.json")
    meta = pd.read_parquet(os.path.join(prep, "meta.parquet"),
                           columns=["item_id", "store_id", "abcxyz", "abcxyz_merged"])
    if stores:
        stores = [str(s) for s in stores]
        unknown = set(stores) - set(meta.store_id.unique())
        if unknown:
            raise ValueError(f"unknown stores: {sorted(unknown)}")
        rows = np.flatnonzero(meta.store_id.isin(stores).values)
    else:
        rows = np.arange(len(meta))
    contiguous = len(rows) > 0 and rows[-1] - rows[0] + 1 == len(rows)
    sel = slice(int(rows[0]), int(rows[-1]) + 1) if contiguous else rows

    y = np.asarray(np.load(os.path.join(prep, "y.npy"), mmap_mode="r")[sel], dtype=np.float64)
    price = np.asarray(np.load(os.path.join(prep, "price.npy"), mmap_mode="r")[sel], dtype=np.float64)
    if labels == "teacher":
        lab = meta.abcxyz_merged.values[rows].astype(str)
    elif labels == "merge_small":
        lab = merge_small(meta.abcxyz.values[rows].astype(str))
    else:
        raise ValueError("labels must be 'teacher' or 'merge_small'")
    names, groups = np.unique(lab, return_inverse=True)

    fdir = _forecast_dir(teacher_dir, model)
    origins = np.load(os.path.join(fdir, "origins.npy"))
    expected = cfg.review_days
    idx = np.searchsorted(origins, expected)
    if np.any(idx >= len(origins)) or not np.array_equal(origins[np.minimum(idx, len(origins) - 1)], expected):
        raise ValueError(f"{fdir}/origins.npy does not contain every review origin {cfg.VAL_START}+k*{cfg.R}")
    qa = np.load(os.path.join(fdir, f"Q_H{cfg.L + cfg.R}.npy"), mmap_mode="r")
    if qa.ndim != 3 or qa.shape[1] != len(meta):
        raise ValueError(f"unexpected Q_H{cfg.L + cfg.R} shape {qa.shape}")
    q = np.empty((len(expected), len(rows)))
    for j, o in enumerate(idx):
        q[j] = np.asarray(qa[int(o), sel, cfg.level_index], dtype=np.float64)
    return ReplayInputs(y=y, price=price, groups=groups.astype(np.int64), class_names=[str(s) for s in names],
                        q=q, review_days=expected, L=cfg.L, R=cfg.R,
                        store_id=meta.store_id.values[rows].astype(str),
                        item_id=meta.item_id.values[rows].astype(str), model=model)


def load_teacher_selection(teacher_dir: str, model: str, L: int, R: int, experiment: str = "e10b") -> list:
    """Read ``DFIOS/results/<experiment>/m5/<model>_L<L>_R<R>/selection.json`` (read-only)."""
    path = os.path.join(teacher_dir, "DFIOS", "results", experiment, "m5", f"{model}_L{L}_R{R}", "selection.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)
