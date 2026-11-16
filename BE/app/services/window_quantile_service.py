"""
Bridge "route (c)" (research.md §6.1): point forecast of the protection window + empirical
quantile of the window error of MATURED origins.

    F_hat_{i,o}(H) = sum_{h=1..H} y_hat_{i,o,h}                 (Tier 1 Ensemble only, run chosen by origin)
    r_{i,s}(H)     = sum_{t in [s, s+H)} y_{i,t} - F_hat_{i,s}(H)  (s from forecast_backtest, s + H <= o)
    Q_hat_{i,o}(tau) = max(0, F_hat_{i,o}(H) + quantile_tau{ r_{i,s}(H) })

Fixes over the previous version (PROJECT_REVIEW P-01, N-13, R-06, R-07, R-15, P-24, B-04):
  * a residual window is used ONLY when all H days of actual demand exist; a missing day is never
    treated as 0 (that produced r ~ -10*d_hat and Q_hat < F_hat);
  * actuals come from sales_history and, for days missing in the DB, from the M5 CSV
    (``M5_SALES_CSV_PATH``) -- only days strictly before the origin (causality);
  * ``forecast_backtest.dhat`` already is the H-day window sum (artifact c3ok, W = 10) and the review
    day ``r`` is a 0-based M5 day index, so the window is [r, r+H) (not ``dhat * H`` and not ``r - 1``);
  * the point forecast uses a SINGLE forecast run chosen by origin (latest run with run_start <= origin
    that covers the whole window), filtered to the Ensemble model only;
  * the empirical / Gaussian-fallback decision is persisted in ``route`` ("c" / "c_fb").

A single implementation (``_compute_items``) serves the per-SKU and the bulk entry points, so
bulk == per-SKU by construction.
"""
from __future__ import annotations

import logging
import math
import os
import warnings
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from app.models.forecast import Forecast, ForecastOverride
from app.models.forecast_backtest import ForecastBacktest
from app.models.forecast_window_quantile import ForecastWindowQuantile
from app.models.sales_history import SalesHistory
from app.services import policy_config as pc

logger = logging.getLogger(__name__)

ROUTE_C_TAU_LEVELS = [
    0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.60, 0.70, 0.75,
    0.80, 0.85, 0.90, 0.93, 0.95, 0.96, 0.9615, 0.97, 0.975, 0.98, 0.985, 0.99, 0.995, 0.999,
]

# Gaussian z-scores, used only by the labelled fallback when too few matured windows exist.
GAUSSIAN_Z = {
    0.05: -1.645, 0.10: -1.282, 0.15: -1.036, 0.20: -0.842, 0.25: -0.674,
    0.30: -0.524, 0.40: -0.253, 0.50: 0.0, 0.60: 0.253, 0.70: 0.524,
    0.75: 0.674, 0.80: 0.842, 0.85: 1.036, 0.90: 1.282, 0.93: 1.476,
    0.95: 1.645, 0.96: 1.751, 0.9615: 1.769, 0.97: 1.881, 0.975: 1.960, 0.98: 2.054,
    0.985: 2.170, 0.99: 2.326, 0.995: 2.576, 0.999: 3.090,
}



def gaussian_z(tau: float) -> float:
    """R5B-05: z of the Gaussian fallback for ANY tau (the table above is kept for the listed levels)."""
    from statistics import NormalDist
    t = round(float(tau), 4)
    if t in GAUSSIAN_Z:
        return GAUSSIAN_Z[t]
    return float(NormalDist().inv_cdf(min(0.9999, max(0.0001, float(tau)))))


DEFAULT_MODEL_RUN_ID = "backtest-ensemble-v1"
_IN_CHUNK = 900


# ---------------------------------------------------------------------------------------------
# M5 CSV actuals (optional, read-only, used for days missing in sales_history)
# ---------------------------------------------------------------------------------------------
class M5ActualsCache:
    """Lazy, per-store cache of the M5 ``sales_train_*.csv`` matrix (float32, items x days)."""

    def __init__(self) -> None:
        self._path_override: Optional[str] = None
        self._cache: Dict[Tuple[str, str], Tuple[Dict[str, int], np.ndarray]] = {}

    def configure(self, path: Optional[str]) -> None:
        self._path_override = path
        self._cache.clear()

    def path(self) -> Optional[str]:
        p = self._path_override if self._path_override is not None else os.getenv("M5_SALES_CSV_PATH")
        return p if p and os.path.exists(p) else None

    def get(self, store_id: str) -> Optional[Tuple[Dict[str, int], np.ndarray]]:
        path = self.path()
        if not path:
            return None
        key = (path, store_id)
        if key in self._cache:
            return self._cache[key]
        try:
            header = pd.read_csv(path, nrows=0).columns
            dcols = [c for c in header if c.startswith("d_")]
            usecols = ["item_id", "store_id"] + dcols
            dtypes = {c: "float32" for c in dcols}
            parts = []
            for chunk in pd.read_csv(path, usecols=usecols, dtype=dtypes, chunksize=5000):
                sub = chunk[chunk["store_id"] == store_id]
                if len(sub):
                    parts.append(sub)
            if not parts:
                return None
            df = pd.concat(parts, ignore_index=True)
            index = {iid: i for i, iid in enumerate(df["item_id"].tolist())}
            mat = df[dcols].to_numpy(dtype=np.float32)
        except Exception:
            logger.exception("M5ActualsCache: cannot read %s", path)
            return None
        self._cache[key] = (index, mat)
        return self._cache[key]


m5_actuals = M5ActualsCache()


def build_actuals_matrix(
    db: Session,
    store_id: str,
    item_ids: Sequence[str],
    start_idx: int,
    end_idx_excl: int,
) -> np.ndarray:
    """
    Actual daily demand, shape (n_items, end-start), NaN where the day is unknown.
    Source order: M5 CSV (if configured) then sales_history overrides it. Only days < end_idx_excl.
    """
    n_days = max(0, end_idx_excl - start_idx)
    A = np.full((len(item_ids), n_days), np.nan, dtype=np.float64)
    if n_days == 0 or not item_ids:
        return A
    pos = {iid: i for i, iid in enumerate(item_ids)}

    cached = m5_actuals.get(store_id)
    if cached is not None:
        index, mat = cached
        lo, hi = max(0, start_idx), min(mat.shape[1], end_idx_excl)
        if hi > lo:
            for iid, i in pos.items():
                j = index.get(iid)
                if j is not None:
                    A[i, lo - start_idx: hi - start_idx] = mat[j, lo:hi]

    d0 = pc.day_index_to_date(start_idx)
    d1 = pc.day_index_to_date(end_idx_excl - 1)
    ids = list(item_ids)
    for k in range(0, len(ids), _IN_CHUNK):
        chunk = ids[k:k + _IN_CHUNK]
        rows = (
            db.query(SalesHistory.item_id, SalesHistory.sale_date, SalesHistory.quantity)
            .filter(
                SalesHistory.store_id == store_id,
                SalesHistory.item_id.in_(chunk),
                SalesHistory.sale_date >= d0,
                SalesHistory.sale_date <= d1,
            )
            .all()
        )
        for iid, sd, qty in rows:
            col = pc.date_to_day_index(sd) - start_idx
            if 0 <= col < n_days and qty is not None:
                A[pos[iid], col] = float(qty)
    return A


def window_sums(A: np.ndarray, rel_starts: np.ndarray, H: int) -> np.ndarray:
    """
    Sum of A over [j, j+H) for every relative start j; NaN when any day of the window is missing
    or the window leaves the matrix. Shape (n_items, len(rel_starts)). Missing is NEVER 0.
    """
    n, T = A.shape
    isn = np.isnan(A)
    cs = np.concatenate([np.zeros((n, 1)), np.cumsum(np.where(isn, 0.0, A), axis=1)], axis=1)
    cn = np.concatenate([np.zeros((n, 1)), np.cumsum(isn, axis=1)], axis=1)
    out = np.full((n, len(rel_starts)), np.nan)
    for k, j in enumerate(rel_starts):
        j = int(j)
        if j < 0 or j + H > T:
            continue
        ok = (cn[:, j + H] - cn[:, j]) == 0
        out[ok, k] = (cs[:, j + H] - cs[:, j])[ok]
    return out


# ---------------------------------------------------------------------------------------------
# Pure numerical core
# ---------------------------------------------------------------------------------------------
def residual_quantiles(
    point: np.ndarray,
    residuals: np.ndarray,
    taus: Sequence[float],
    quantile_floor: float = 1.0,
) -> np.ndarray:
    """
    Q_hat(tau) = max(0, F_hat + nanquantile_tau(r)), shape (n_items, n_taus).
    ``residuals`` is (n_items, n_origins) with NaN for unusable windows. Floor: tau >= 0.90 and F_hat > 0.
    """
    point = np.asarray(point, dtype=float)
    out = np.empty((len(point), len(taus)))
    for k, tau in enumerate(taus):
        r_q = np.nanquantile(residuals, tau, axis=1)
        q = np.maximum(0.0, point + r_q)
        if tau >= 0.90 and quantile_floor:
            q = np.where(point > 0, np.maximum(q, quantile_floor), q)
        out[:, k] = q
    return out


@dataclass
class ItemWindow:
    item_id: str
    point_window: float
    residuals: np.ndarray
    point_source: str  # forecast_run | backtest | sales_mean | none
    run_start: Optional[date] = None
    sigma_hint: Optional[float] = None
    extra: Dict[str, Any] = field(default_factory=dict)


class WindowQuantileService:
    # ------------------------------------------------------------------------------------
    # internal: gather inputs for many items at once
    # ------------------------------------------------------------------------------------
    def _point_forecasts(
        self,
        db: Session,
        store_id: str,
        item_ids: Sequence[str],
        origin_date: date,
        H: int,
        model_version: Optional[str],
    ) -> Dict[str, Tuple[float, Optional[date]]]:
        """F_hat per item from ONE forecast run per item (latest run_start <= origin covering the window)."""
        o_idx = pc.date_to_day_index(origin_date)
        lo = origin_date - timedelta(days=27)
        hi = origin_date + timedelta(days=H - 1)
        frames = []
        for k in range(0, len(item_ids), _IN_CHUNK):
            chunk = list(item_ids[k:k + _IN_CHUNK])
            q = db.query(
                Forecast.item_id, Forecast.forecast_date, Forecast.h, Forecast.y_pred, Forecast.generated_at
            ).filter(
                Forecast.store_id == store_id,
                Forecast.item_id.in_(chunk),
                Forecast.forecast_date >= lo,
                Forecast.forecast_date <= hi,
                Forecast.h >= 1,
            )
            if model_version:
                q = q.filter(Forecast.model_version == model_version)
            else:  # P-24: strict model filter, Ensemble only (never SBA / fast-inference / production-lightgbm)
                q = q.filter(Forecast.model_version.ilike(pc.POINT_FORECAST_MODEL_PATTERN))
            frames.append(pd.DataFrame(q.all(), columns=["item_id", "forecast_date", "h", "y_pred", "gen"]))
        if not frames:
            return {}
        df = pd.concat(frames, ignore_index=True)
        if df.empty:
            return {}
        df["d_idx"] = (pd.to_datetime(df["forecast_date"]) - pd.Timestamp(pc.M5_DAY0)).dt.days
        df["run_idx"] = df["d_idx"] - (df["h"].astype(int) - 1)
        df = df[(df["run_idx"] <= o_idx) & (df["d_idx"] >= o_idx) & (df["d_idx"] <= o_idx + H - 1)]
        if df.empty:
            return {}
        # keep newest generated row per (item, run, day)
        df = df.sort_values("gen", na_position="first").drop_duplicates(["item_id", "run_idx", "d_idx"], keep="last")

        # overrides (B-04): exact (date,h) first, then date-level (h is NULL)
        ov_h: Dict[Tuple[str, int, int], float] = {}
        ov_d: Dict[Tuple[str, int], float] = {}
        for k in range(0, len(item_ids), _IN_CHUNK):
            chunk = list(item_ids[k:k + _IN_CHUNK])
            for ov in (
                db.query(ForecastOverride)
                .filter(
                    ForecastOverride.store_id == store_id,
                    ForecastOverride.item_id.in_(chunk),
                    ForecastOverride.is_active.is_(True),
                )
                .order_by(ForecastOverride.created_at.asc())
                .all()
            ):
                di = pc.date_to_day_index(ov.forecast_date)
                if ov.h is not None:
                    ov_h[(ov.item_id, di, int(ov.h))] = float(ov.override_value)
                else:
                    ov_d[(ov.item_id, di)] = float(ov.override_value)
        if ov_h or ov_d:
            df["y_pred"] = [
                ov_h.get((i, d, int(h)), ov_d.get((i, d), y))
                for i, d, h, y in zip(df["item_id"], df["d_idx"], df["h"], df["y_pred"])
            ]

        out: Dict[str, Tuple[float, Optional[date]]] = {}
        cnt = df.groupby(["item_id", "run_idx"])["d_idx"].nunique().reset_index(name="n")
        cnt = cnt[cnt["n"] >= H]
        if cnt.empty:
            return out
        best = cnt.sort_values("run_idx").groupby("item_id").tail(1)
        sums = df.groupby(["item_id", "run_idx"])["y_pred"].sum()
        for iid, rix in zip(best["item_id"], best["run_idx"]):
            out[iid] = (float(sums.loc[(iid, rix)]), pc.day_index_to_date(int(rix)))
        return out

    def _backtest_rows(
        self, db: Session, store_id: str, item_ids: Sequence[str], o_idx: int
    ) -> pd.DataFrame:
        frames = []
        for k in range(0, len(item_ids), _IN_CHUNK):
            chunk = list(item_ids[k:k + _IN_CHUNK])
            rows = (
                db.query(ForecastBacktest.item_id, ForecastBacktest.review_day, ForecastBacktest.dhat,
                         ForecastBacktest.sigma_d)
                .filter(
                    ForecastBacktest.store_id == store_id,
                    ForecastBacktest.item_id.in_(chunk),
                    ForecastBacktest.review_day <= o_idx,
                    ForecastBacktest.review_day >= o_idx - pc.RESIDUAL_LOOKBACK_DAYS - 7,
                )
                .all()
            )
            frames.append(pd.DataFrame(rows, columns=["item_id", "review_day", "dhat", "sigma_d"]))
        return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(
            columns=["item_id", "review_day", "dhat", "sigma_d"])

    def _review_matrices(
        self,
        db: Session,
        store_id: str,
        item_ids: Sequence[str],
        bt: pd.DataFrame,
        actuals_end_idx: int,
        H: int,
        scale: float,
        s_min: int,
        s_max: int,
    ) -> Tuple[List[int], np.ndarray, np.ndarray]:
        """
        For reviews s in [s_min, s_max] present in forecast_backtest: forecast window D (items x reviews)
        and residual R = actual window [s, s+H) - D. NaN when the forecast or any actual day is missing.
        Actuals are read only for days < ``actuals_end_idx`` (causality).
        """
        pos = {iid: i for i, iid in enumerate(item_ids)}
        reviews = sorted(int(x) for x in bt["review_day"].unique()) if len(bt) else []
        reviews = [s for s in reviews if s_min <= s <= s_max]
        D = np.full((len(item_ids), len(reviews)), np.nan)
        R = np.full((len(item_ids), len(reviews)), np.nan)
        if not reviews:
            return reviews, D, R
        a0 = reviews[0]
        A = build_actuals_matrix(db, store_id, item_ids, a0, actuals_end_idx)
        act = window_sums(A, np.array([s - a0 for s in reviews]), H)
        midx = {s: k for k, s in enumerate(reviews)}
        sub = bt[bt["review_day"].isin(reviews)]
        for iid, s, d in zip(sub["item_id"], sub["review_day"], sub["dhat"]):
            i, k = pos[iid], midx[int(s)]
            D[i, k] = float(d) * scale
            R[i, k] = act[i, k] - D[i, k]
        return reviews, D, R

    def causal_quantile_matrix(
        self,
        db: Session,
        store_id: str,
        item_ids: Sequence[str],
        review_days: Sequence[int],
        tau: float,
        H: int = pc.HORIZON_DAYS,
        quantile_floor: float = 1.0,
    ) -> Dict[str, Any]:
        """
        Causal Q_hat_tau for every (item, review) -- the input of the J5 policy backtest.
        For review s_k: F_hat = backtest window forecast of s_k; residuals only from reviews with
        s_j + H <= s_k and s_j >= s_k - 364. Items/reviews with < MIN_RESIDUALS use the labelled
        Gaussian fallback (flag ``fallback``).
        Returns dict(point, q, n_res, fallback) each (items x reviews).
        """
        item_ids = list(dict.fromkeys(item_ids))
        review_days = [int(x) for x in review_days]
        scale = H / float(pc.BACKTEST_WINDOW_DAYS)
        last = max(review_days) if review_days else 0
        s_lo = max(0, min(review_days) - pc.RESIDUAL_LOOKBACK_DAYS) if review_days else 0
        bt_frames = []
        for k in range(0, len(item_ids), _IN_CHUNK):
            chunk = item_ids[k:k + _IN_CHUNK]
            rows = (
                db.query(ForecastBacktest.item_id, ForecastBacktest.review_day, ForecastBacktest.dhat,
                         ForecastBacktest.sigma_d)
                .filter(ForecastBacktest.store_id == store_id, ForecastBacktest.item_id.in_(chunk),
                        ForecastBacktest.review_day >= s_lo, ForecastBacktest.review_day <= last)
                .all()
            )
            bt_frames.append(pd.DataFrame(rows, columns=["item_id", "review_day", "dhat", "sigma_d"]))
        bt = pd.concat(bt_frames, ignore_index=True) if bt_frames else pd.DataFrame(
            columns=["item_id", "review_day", "dhat", "sigma_d"])
        n, K = len(item_ids), len(review_days)
        out = {k: np.full((n, K), np.nan) for k in ("point", "q")}
        out["n_res"] = np.zeros((n, K), dtype=int)
        out["fallback"] = np.ones((n, K), dtype=bool)
        if not len(bt) or not K:
            return out
        reviews, D, R = self._review_matrices(
            db, store_id, item_ids, bt, last + H, H, scale, s_lo, last
        )
        rv = np.array(reviews)
        pos_rev = {s: j for j, s in enumerate(reviews)}
        pos_item = {iid: i for i, iid in enumerate(item_ids)}
        sig = np.full(n, np.nan)
        for iid, sg in bt.groupby("item_id")["sigma_d"].last().items():
            sig[pos_item[iid]] = float(sg)
        z = gaussian_z(tau)
        for k, s_k in enumerate(review_days):
            if s_k not in pos_rev:
                continue
            point = D[:, pos_rev[s_k]]
            cols = (rv >= s_k - pc.RESIDUAL_LOOKBACK_DAYS) & (rv + H <= s_k)
            Rk = R[:, cols]
            nres = (~np.isnan(Rk)).sum(axis=1) if Rk.shape[1] else np.zeros(n, dtype=int)
            q = np.full(n, np.nan)
            ok = nres >= pc.MIN_RESIDUALS
            if ok.any():
                q[ok] = residual_quantiles(point[ok], Rk[ok], [tau], quantile_floor)[:, 0]
            if (~ok).any():
                sg = np.where(np.isnan(sig), 0.0, sig) * math.sqrt(H)
                sg = np.maximum(sg, np.sqrt(np.maximum(point, 1.0)))
                qf = np.maximum(0.0, point + z * sg)
                if quantile_floor and tau >= 0.90:
                    qf = np.where(point > 0, np.maximum(qf, quantile_floor), qf)
                q[~ok] = qf[~ok]
            out["point"][:, k] = point
            out["q"][:, k] = q
            out["n_res"][:, k] = nres
            out["fallback"][:, k] = ~ok
        return out

    def _compute_items(
        self,
        db: Session,
        store_id: str,
        item_ids: Sequence[str],
        origin_date: date,
        horizon_days: int,
        model_version: Optional[str] = None,
    ) -> Dict[str, ItemWindow]:
        H = int(horizon_days)
        item_ids = list(dict.fromkeys(item_ids))
        o_idx = pc.date_to_day_index(origin_date)
        scale = H / float(pc.BACKTEST_WINDOW_DAYS)  # dhat is a BACKTEST_WINDOW_DAYS window sum

        points = self._point_forecasts(db, store_id, item_ids, origin_date, H, model_version)
        bt = self._backtest_rows(db, store_id, item_ids, o_idx)

        # --- residual matrix: matured origins only: o - 364 <= s <= o - H -------------------
        s_min = max(0, o_idx - pc.RESIDUAL_LOOKBACK_DAYS)
        s_max = o_idx - H
        pos = {iid: i for i, iid in enumerate(item_ids)}
        reviews, _D, Rall = self._review_matrices(db, store_id, item_ids, bt, o_idx, H, scale, s_min, s_max)
        R = Rall

        # --- fallbacks for the point forecast -------------------------------------------------
        latest_bt: Dict[str, Tuple[float, float]] = {}
        if len(bt):
            last = bt.sort_values("review_day").groupby("item_id").tail(1)
            for iid, d, sg in zip(last["item_id"], last["dhat"], last["sigma_d"]):
                latest_bt[iid] = (float(d) * scale, float(sg))
        need_mean = [i for i in item_ids if i not in points and i not in latest_bt]
        sales_mean: Dict[str, float] = {}
        if need_mean:
            A28 = build_actuals_matrix(db, store_id, need_mean, max(0, o_idx - 28), o_idx)
            with np.errstate(all="ignore"), warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN row -> NaN (no sales mean), skipped below
                m = np.nanmean(A28, axis=1) if A28.shape[1] else np.full(len(need_mean), np.nan)
            sales_mean = {iid: float(v) for iid, v in zip(need_mean, m) if not np.isnan(v)}

        sig_map = {iid: sg for iid, (_, sg) in latest_bt.items()}
        out: Dict[str, ItemWindow] = {}
        for iid in item_ids:
            if iid in points:
                pt, run_start = points[iid]
                src = "forecast_run"
            elif iid in latest_bt:
                pt, run_start, src = latest_bt[iid][0], None, "backtest"
            elif iid in sales_mean:
                pt, run_start, src = sales_mean[iid] * H, None, "sales_mean"
            else:
                pt, run_start, src = 0.0, None, "none"
            r = R[pos[iid]]
            out[iid] = ItemWindow(
                item_id=iid, point_window=float(round(pt, 4)), residuals=r[~np.isnan(r)],
                point_source=src, run_start=run_start, sigma_hint=sig_map.get(iid),
            )
        return out

    # ------------------------------------------------------------------------------------
    # public low-level API (backward compatible)
    # ------------------------------------------------------------------------------------
    def compute_point_window_forecast(
        self,
        db: Session,
        item_id: str,
        store_id: str,
        origin_date: date,
        horizon_days: int = pc.HORIZON_DAYS,
        model_version: Optional[str] = None,
    ) -> float:
        w = self._compute_items(db, store_id, [item_id], origin_date, horizon_days, model_version)
        return float(round(w[item_id].point_window, 2))

    def collect_historical_residuals(
        self,
        db: Session,
        item_id: str,
        store_id: str,
        origin_date: date,
        horizon_days: int = pc.HORIZON_DAYS,
        max_origins: int = 52,
        model_run_id: str = DEFAULT_MODEL_RUN_ID,
    ) -> np.ndarray:
        """Residuals of matured origins with COMPLETE actuals only (most recent ``max_origins``)."""
        w = self._compute_items(db, store_id, [item_id], origin_date, horizon_days)
        return w[item_id].residuals[-max_origins:]

    def calculate_quantiles_dict(
        self,
        point_window: float,
        residuals: np.ndarray,
        tau_levels: Optional[List[float]] = None,
        quantile_floor: float = 1.0,
        sigma_hint: Optional[float] = None,
        horizon_days: int = pc.HORIZON_DAYS,
    ) -> Dict[str, float]:
        """
        Q_hat(tau) for all levels. Empirical when len(residuals) >= MIN_RESIDUALS, else a Gaussian
        fallback (the caller labels the record route='c_fb').
        """
        levels = tau_levels or ROUTE_C_TAU_LEVELS
        residuals = np.asarray(residuals, dtype=float)
        residuals = residuals[~np.isnan(residuals)]
        if len(residuals) >= pc.MIN_RESIDUALS:
            q = residual_quantiles(np.array([point_window]), residuals[None, :], levels, quantile_floor)[0]
        else:
            sigma_h = (sigma_hint or 0.0) * math.sqrt(horizon_days)
            sigma_h = max(sigma_h, math.sqrt(max(point_window, 1.0)))  # Poisson-like lower bound
            q = np.array([max(0.0, point_window + gaussian_z(t) * sigma_h) for t in levels])
            if quantile_floor:
                q = np.where((np.array(levels) >= 0.90) & (point_window > 0), np.maximum(q, quantile_floor), q)
        return {str(t): round(float(v), 2) for t, v in zip(levels, q)}

    # ------------------------------------------------------------------------------------
    # persistence helpers
    # ------------------------------------------------------------------------------------
    @staticmethod
    def _record_id(model_run_id: str, store_id: str, item_id: str, origin_date: date, H: int) -> str:
        return f"{model_run_id}_{store_id}_{item_id}_{origin_date}_{H}"

    def build_records(
        self,
        db: Session,
        store_id: str,
        item_ids: Sequence[str],
        origin_date: date,
        horizon_days: int = pc.HORIZON_DAYS,
        model_run_id: str = DEFAULT_MODEL_RUN_ID,
        model_version: Optional[str] = None,
        quantile_floor: float = 1.0,
    ) -> List[ForecastWindowQuantile]:
        """Compute (not persist) the window-quantile records for many items (vectorised)."""
        windows = self._compute_items(db, store_id, item_ids, origin_date, horizon_days, model_version)
        now = datetime.now(timezone.utc)
        recs: List[ForecastWindowQuantile] = []
        for iid, w in windows.items():
            n_res = len(w.residuals)
            q = self.calculate_quantiles_dict(
                w.point_window, w.residuals, ROUTE_C_TAU_LEVELS, quantile_floor,
                sigma_hint=w.sigma_hint, horizon_days=horizon_days,
            )
            recs.append(ForecastWindowQuantile(
                id=self._record_id(model_run_id, store_id, iid, origin_date, horizon_days),
                model_run_id=model_run_id, store_id=store_id, item_id=iid,
                origin_date=origin_date, horizon_days=horizon_days,
                point_window=w.point_window, q_levels=q,
                route=pc.ROUTE_EMPIRICAL if n_res >= pc.MIN_RESIDUALS else pc.ROUTE_FALLBACK,
                created_at=now,
            ))
        return recs

    def get_or_create_window_quantiles_bulk(
        self,
        db: Session,
        store_id: str,
        item_ids: Sequence[str],
        origin_date: date,
        horizon_days: int = pc.HORIZON_DAYS,
        model_run_id: str = DEFAULT_MODEL_RUN_ID,
        persist: bool = True,
        quantile_floor: float = 1.0,
    ) -> Dict[str, ForecastWindowQuantile]:
        """Existing records are reused; missing ones are computed in ONE vectorised pass."""
        item_ids = list(dict.fromkeys(item_ids))
        found: Dict[str, ForecastWindowQuantile] = {}
        for k in range(0, len(item_ids), _IN_CHUNK):
            chunk = item_ids[k:k + _IN_CHUNK]
            for r in (
                db.query(ForecastWindowQuantile)
                .filter(
                    ForecastWindowQuantile.store_id == store_id,
                    ForecastWindowQuantile.item_id.in_(chunk),
                    ForecastWindowQuantile.origin_date == origin_date,
                    ForecastWindowQuantile.horizon_days == horizon_days,
                    ForecastWindowQuantile.model_run_id == model_run_id,
                )
                .all()
            ):
                found[r.item_id] = r
        missing = [i for i in item_ids if i not in found]
        if missing:
            new_recs = self.build_records(
                db, store_id, missing, origin_date, horizon_days, model_run_id, None, quantile_floor
            )
            if persist and new_recs:
                try:
                    # idempotent: drop any row with the same primary key (race / partial earlier run), then insert
                    ids = [r.id for r in new_recs]
                    for k in range(0, len(ids), _IN_CHUNK):
                        db.query(ForecastWindowQuantile).filter(
                            ForecastWindowQuantile.id.in_(ids[k:k + _IN_CHUNK])
                        ).delete(synchronize_session=False)
                    db.add_all(new_recs)
                    db.commit()
                except Exception:
                    db.rollback()
                    raise
            for r in new_recs:
                found[r.item_id] = r
        return found

    def get_or_create_window_quantile(
        self,
        db: Session,
        store_id: str,
        item_id: str,
        origin_date: date,
        horizon_days: int = pc.HORIZON_DAYS,
        model_run_id: str = DEFAULT_MODEL_RUN_ID,
        persist: bool = True,
    ) -> ForecastWindowQuantile:
        """Per-SKU entry point; same code path as the bulk one. persist=False never writes (GET safe)."""
        res = self.get_or_create_window_quantiles_bulk(
            db, store_id, [item_id], origin_date, horizon_days, model_run_id, persist=persist
        )
        return res[item_id]

    def get_tau_quantile_value(
        self,
        db: Session,
        store_id: str,
        item_id: str,
        origin_date: date,
        tau: float = 0.95,
        horizon_days: int = pc.HORIZON_DAYS,
        model_run_id: str = DEFAULT_MODEL_RUN_ID,
    ) -> float:
        record = self.get_or_create_window_quantile(
            db, store_id, item_id, origin_date, horizon_days, model_run_id
        )
        return self.tau_value(record.q_levels or {}, tau, record.point_window)

    @staticmethod
    def tau_value(q_dict: Dict[str, float], tau: float, point_window: float = 0.0) -> float:
        """Q_hat(tau) from a stored dict; nearest stored level if the exact one is absent."""
        key = str(tau)
        if key in q_dict:
            return float(q_dict[key])
        levels = [float(k) for k in q_dict.keys()]
        if levels:
            nearest = min(levels, key=lambda x: abs(x - tau))
            return float(q_dict[str(nearest)])
        return float(point_window)  # no invented multiplier


window_quantile_service = WindowQuantileService()
