"""Additive Holt-Winters baseline of the teacher's E2b (DFIOS/experiments/e2b_baselines_tests.py ``holt_winters``),
used by the Forecast Explorer error table (demo.md §6.2: "So sánh mô hình: Ensemble với Seasonal Naive / Holt-Winters /
LightGBM trên SKU đang chọn").

Weekly season, optional damped trend; (alpha, gamma, trend) per series from the same 30-point grid, chosen by the
one-step squared error on the 364 days before ``fit_end`` (the teacher uses fit_end = d_1395). The path at origin
``o`` uses ``y[:, :o]`` only (causal). The app's sales history starts later than M5 d_1, so the level / season start
from the first 28 days held in the database: same method, not the teacher's exact numbers.
"""
from __future__ import annotations

from typing import Dict, Iterable, Tuple

import numpy as np

ALPHA = (0.02, 0.05, 0.1, 0.2, 0.3)
GAMMA = (0.01, 0.05, 0.1)
TREND = ((0.0, 1.0), (0.02, 0.9))  # (beta, phi): none, damped
FIT_END_DEFAULT = 1395             # teacher: params by one-step MSE on the 364 days before d_1395
FIT_DAYS = 364
INIT_DAYS = 28


def holt_winters_paths(y: np.ndarray, fit_end: int, origins: Iterable[int], h: int) -> Tuple[Dict[int, np.ndarray], tuple]:
    """``y``: (n, T) daily demand from index 0 (no NaN). ``fit_end`` / ``origins`` are indices into ``y``.
    Returns ({origin: (n, h) daily path >= 0}, chosen grid point of the first series)."""
    y = np.asarray(y, dtype=float)
    n, T = y.shape
    origins = sorted({int(o) for o in origins if 0 < int(o) <= T})
    grid = [(a, g, b, p) for a in ALPHA for g in GAMMA for b, p in TREND]
    A, Gm, B, P = (np.array(v)[:, None] for v in zip(*grid))

    def run(A, Gm, B, P, keep=None, sse_from=None, sse_to=None):
        m = A.shape[0]
        lv = np.repeat(y[None, :, :INIT_DAYS].mean(2), m, 0)
        b = np.zeros_like(lv)
        S = np.stack([y[:, w:INIT_DAYS:7].mean(1) for w in range(7)], 1)[None] - lv[..., None]  # [m, n, 7]
        sse = np.zeros_like(lv)
        out = {}
        for t in range(T):
            s = S[:, :, t % 7]
            if keep is not None and t in keep:
                out[t] = (lv.copy(), b.copy(), S.copy())
            if sse_from is not None and sse_from <= t < sse_to:
                sse += (lv + P * b + s - y[None, :, t]) ** 2
            ln = A * (y[None, :, t] - s) + (1 - A) * (lv + P * b)
            b = B * (ln - lv) + (1 - B) * P * b
            S[:, :, t % 7] = Gm * (y[None, :, t] - ln) + (1 - Gm) * s
            lv = ln
        if keep is not None and T in keep:  # an origin right after the last known day
            out[T] = (lv.copy(), b.copy(), S.copy())
        return sse, out

    sse, _ = run(A, Gm, B, P, sse_from=max(0, fit_end - FIT_DAYS), sse_to=fit_end)
    best = sse.argmin(0)
    pick = lambda v: v[best, 0][None, :]  # noqa: E731
    _, st = run(pick(A), pick(Gm), pick(B), pick(P), keep=set(origins))
    phi = pick(P)[0]
    cum = np.cumsum(phi[None, :] ** np.arange(1, h + 1)[:, None], 0)  # [h, n]
    paths: Dict[int, np.ndarray] = {}
    for o in origins:
        if o not in st:
            continue
        lv, b, S = (v[0] for v in st[o])
        seas = S[:, (o + np.arange(h)) % 7]
        paths[o] = np.maximum(lv[:, None] + cum.T * b[:, None] + seas, 0)
    return paths, grid[int(best[0])] if n else None
