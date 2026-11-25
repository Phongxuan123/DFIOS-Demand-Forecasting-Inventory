"""
FR10 what-if: a REAL re-simulation of (R, s, S) policies on the store's own history (research.md 7.2-7.4).

Replay span: the last ``n_reviews`` consecutive WEEKLY review periods before the simulated clock (and before the
last day with realised sales), i.e. [t_0, t_0 + 7 * n_reviews). With R = 7 the reviews are t_0 + 7k; with R = 1 the
SAME span is replayed with a review every day (7 * n_reviews reviews), so both review periods are compared on the
same days. Every class of the store is replayed with the vectorised lost-sales backtest of ``policy_backtest`` (the
engine of job J5, ``simulate_rss_candidates``):

* Q_hat_tau at each review, window H = L + R: imported teacher window quantiles (route 'teacher',
  forecast_window_quantile rows with horizon_days = H at that origin; daily origins come from
  ``load_teacher_data.py --daily-origins --horizons 4 10``) where they exist, else (R = 7 only) the causal
  route-(c) quantile from ``forecast_backtest`` (window forecast + empirical residual quantile of matured H-day
  windows). Nothing after a review is used to compute its quantile; nothing after the clock is used at all.
* daily demand = realised sales of the replayed days (sales_history); an item missing ANY replayed day, any review
  quantile or a price is excluded (never zero-filled, never an invented price);
* s = ceil(Q_hat * e^(m_g [+ theta_g])), S = s + ceil(kappa_g * EOQ), EOQ = sqrt(2 c mu / (h p)) with mu = mean
  actual sales of the 56 days before the review and p = the price of the review day (engine / teacher E10b rule,
  user's h and c); order S - IP when IP < s (strict, G-02), arrival at the start of day t + L; costs
  h*price*end-of-day stock + b*price*lost units + c per order line at the price of each day; availability = share
  of SKU-cycles without a zero-stock day, the cycle of review k being days t_k + L .. t_k + L + R - 1 (G-01,
  complete cycles only);
* initial stock (G-03) = round(mean sales of the 28 days before the first replayed review * (L + R)), identical
  for every policy; the legacy ceil(Q_hat) + ceil(EOQ) only for a SKU without any known sales in those 28 days.

Constraints (answered with 422 + reason, never approximated):
* R is replayable only when a window quantile with H = L + R exists at EVERY review day of the span (teacher rows
  of that horizon, or for R = 7 the weekly forecast_backtest reviews). ``r_options`` (in the 422 AND in a success
  response) lists the R in {1, 7} that are replayable for the requested L, checked with one bounded distinct query;
* L in {1, 3, 7} (schema), H = L + R;
* a class needs >= 1 complete item.
"""
from __future__ import annotations

import warnings
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from fastapi import HTTPException, status
from sqlalchemy import case
from sqlalchemy.orm import Session

from app.models.classification import SKUClassification
from app.models.forecast_backtest import ForecastBacktest
from app.models.forecast_window_quantile import ForecastWindowQuantile
from app.models.product import Product
from app.models.sales_history import SalesHistory
from app.repositories import price_history_repository
from app.schemas.simulation import (
    WhatIfClassResult,
    WhatIfMetrics,
    WhatIfPolicy,
    WhatIfPolicyResult,
    WhatIfRequest,
    WhatIfResponse,
    WhatIfSkippedClass,
)
from app.services import policy_backtest
from app.services import policy_config as pc
from app.services.window_quantile_service import build_actuals_matrix, window_quantile_service


def _unprocessable(reason_code: str, reason: str, **extra: Any) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail={"reason_code": reason_code, "reason": reason, **extra},
    )


class WhatIfService:
    DEFAULT_POLICIES = [
        WhatIfPolicy(policy_key="current", label="Current policy (stored m_g, kappa_g + current theta)",
                     use_current=True, use_theta=True),
        WhatIfPolicy(policy_key="raw_quantile", label="Raw quantile (order up to ceil(Q_hat), no controller)",
                     m_g=0.0, kappa_g=0.0, use_theta=False),
    ]

    R_CHOICES = (1, 7)
    WEEK = 7

    # ------------------------------------------------------------------ review days / availability
    @staticmethod
    def _fb_days(db: Session, store_id: str) -> List[int]:
        return sorted(int(r[0]) for r in db.query(ForecastBacktest.review_day)
                      .filter(ForecastBacktest.store_id == store_id).distinct().all())

    @staticmethod
    def _teacher_days(db: Session, store_id: str, H: int, hi: int, n_days: int) -> set:
        """Origins (day indices) < ``hi`` with imported teacher quantiles of window H for the store, only the last
        ``n_days`` days before the latest such origin: one MAX + one bounded DISTINCT query."""
        from sqlalchemy import func

        def base(q):
            return q.filter(
                ForecastWindowQuantile.store_id == store_id,
                ForecastWindowQuantile.horizon_days == int(H),
                ForecastWindowQuantile.route == pc.ROUTE_TEACHER,
                ForecastWindowQuantile.origin_date < pc.day_index_to_date(int(hi)),
            )
        last = base(db.query(func.max(ForecastWindowQuantile.origin_date))).scalar()
        if last is None:
            return set()
        lo = pc.day_index_to_date(pc.date_to_day_index(last) - int(n_days))
        rows = base(db.query(ForecastWindowQuantile.origin_date)).filter(
            ForecastWindowQuantile.origin_date >= lo).distinct().all()
        return {pc.date_to_day_index(r[0]) for r in rows}

    @staticmethod
    def _sales_end(db: Session, store_id: str) -> Optional[int]:
        """Day index AFTER the last realised sales day of the store (None without sales)."""
        from sqlalchemy import func
        last = db.query(func.max(SalesHistory.sale_date)).filter(SalesHistory.store_id == store_id).scalar()
        return pc.date_to_day_index(last) + 1 if last else None

    def _replay_plan(self, db: Session, store_id: str, L: int, o_idx: int, n_reviews: int,
                     fb_days: Optional[List[int]] = None) -> Dict[str, Any]:
        """Replay span (weekly anchored) and, per R in {1, 7}, the review days and whether a window quantile of
        H = L + R exists at every one of them. Raises 422 ``no_review_forecasts`` when the store has none at all."""
        fb = self._fb_days(db, store_id) if fb_days is None else fb_days
        end0 = o_idx
        s_end = self._sales_end(db, store_id)
        if s_end is not None:
            end0 = min(end0, s_end)
        lookback = self.WEEK * (int(n_reviews) + 1)
        avail = {
            1: self._teacher_days(db, store_id, L + 1, end0, lookback),
            7: self._teacher_days(db, store_id, L + self.WEEK, end0, lookback) | {d for d in fb if d < end0},
        }
        if not fb and not avail[1] and not avail[7]:
            raise _unprocessable(
                "no_review_forecasts",
                f"Store '{store_id}' has no stored causal review forecasts (forecast_backtest) and no imported "
                f"window quantiles (H = L + R) before the clock: nothing to replay.")
        # weekly anchor: the longest chain of weekly reviews whose period ends before end0 (the R = 7 grid);
        # without one, the last n_reviews weeks before end0 (only R = 1 can then be replayable)
        weekly = sorted(d for d in avail[7] if d + self.WEEK <= end0)
        if weekly:
            chain = [weekly[-1]]
            have = set(weekly)
            while chain[-1] - self.WEEK in have and len(chain) < int(n_reviews):
                chain.append(chain[-1] - self.WEEK)
            end = chain[0] + self.WEEK
            start = chain[-1]
            if len(chain) < 2:
                weekly = []
        if not weekly:
            daily = sorted(d for d in avail[1] if d + 1 <= end0)
            end = (daily[-1] + 1) if daily else end0
            start = end - self.WEEK * int(n_reviews)
        plan: Dict[str, Any] = {"start": int(start), "end": int(end), "reviews": {}, "ok": {}}
        for r in self.R_CHOICES:
            days = list(range(int(start), int(end), r))
            plan["reviews"][r] = days
            plan["ok"][r] = len(days) >= 2 and all(d in avail[r] for d in days)
        plan["r_options"] = [r for r in self.R_CHOICES if plan["ok"][r]]
        return plan

    def r_options(self, db: Session, store_id: str, L: int = pc.LEAD_TIME_DAYS, n_reviews: int = 21) -> List[int]:
        from app.services.optimization_service import optimization_service
        o_idx = pc.date_to_day_index(optimization_service._store_origin(db, store_id))
        return self._replay_plan(db, store_id, L, o_idx, n_reviews)["r_options"]

    # ------------------------------------------------------------------ inputs of one class
    def _class_inputs(
        self, db: Session, store_id: str, class_id: str, o_idx: int, n_reviews: int, tau: float, L: int, R: int,
        holding_rate: float, order_cost: float, reviews: Optional[List[int]] = None,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[WhatIfSkippedClass]]:
        item_ids = [r[0] for r in db.query(SKUClassification.item_id)
                    .filter(SKUClassification.store_id == store_id, SKUClassification.segment == class_id)
                    .order_by(SKUClassification.item_id).all()]
        if not item_ids:
            return None, WhatIfSkippedClass(class_id=class_id, reason_code="no_items",
                                            reason="No classified SKU in this class for the store.")
        if reviews is None:
            plan = self._replay_plan(db, store_id, L, o_idx, n_reviews)
            reviews = plan["reviews"][R] if plan["ok"][R] else []
        if len(reviews) < 2:
            return None, WhatIfSkippedClass(
                class_id=class_id, reason_code="too_few_reviews",
                reason=f"Fewer than 2 consecutive review quantiles (spacing {R} days) before the clock.")
        H = L + R
        cm = window_quantile_service.causal_quantile_matrix(db, store_id, item_ids, reviews, tau, H)
        start, end = reviews[0], reviews[-1] + R
        hist_lo = max(0, start - max(pc.EOQ_MEAN_WINDOW_DAYS, policy_backtest.INIT_STOCK_WINDOW))
        A_all = build_actuals_matrix(db, store_id, item_ids, hist_lo, end)
        off = start - hist_lo
        A = A_all[:, off:]
        prices = {p.item_id: p.price for p in db.query(Product).filter(Product.item_id.in_(item_ids)).all()}
        price = np.array([float(prices[i]) if prices.get(i) and float(prices[i]) > 0 else np.nan for i in item_ids])
        days_idx = np.concatenate([np.arange(s - reviews[0], s - reviews[0] + R) for s in reviews])
        dem = A[:, days_idx]
        # G-37: same daily-price rules as the engine (J5): every replayed day is valued at its own price
        # (price_history, else products.price) and the EOQ of review k uses the price of the review day; an item
        # without a price on ANY replayed day is excluded. No price_history row -> exactly the constant price.
        p_span = price_history_repository.price_matrix(
            db, store_id, item_ids, pc.day_index_to_date(reviews[0]), pc.day_index_to_date(reviews[-1] + R),
            fallback=price)
        p_day = p_span[:, days_idx]
        ok = (~np.isnan(dem).any(axis=1) & ~np.isnan(cm["q"]).any(axis=1)
              & ~np.isnan(p_day).any(axis=1) & ~(p_day <= 0).any(axis=1))
        if not ok.any():
            return None, WhatIfSkippedClass(
                class_id=class_id, reason_code="no_complete_items",
                reason="No SKU has realised demand on every replayed day, a quantile at every review and a price.")
        p_day_ok = p_day[ok]
        price_ok = np.where(np.isnan(price[ok]), p_day_ok[:, 0], price[ok])
        p_review = p_day_ok[:, [k * R for k in range(len(reviews))]]   # price of each review day
        # engine / teacher E10b: mu_k = mean ACTUAL sales of the 56 days before review k (NaN days ignored, none -> 0)
        A_ok = A_all[ok]
        mu = np.zeros((int(ok.sum()), len(reviews)))
        with np.errstate(all="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            for k, r in enumerate(reviews):
                blk = A_ok[:, max(hist_lo, r - pc.EOQ_MEAN_WINDOW_DAYS) - hist_lo:r - hist_lo]
                mu[:, k] = np.nan_to_num(np.nanmean(blk, axis=1), nan=0.0) if blk.shape[1] else 0.0

        def eoq_for(h: float, c: float) -> np.ndarray:
            with np.errstate(divide="ignore", invalid="ignore"):
                e = np.sqrt(2.0 * float(c) * np.maximum(mu, 0.0) / (float(h) * p_review))
            return np.where(np.isfinite(e), e, 0.0)   # no rounding, no floor (EOQ = 0 without sales)

        eoq = eoq_for(holding_rate, order_cost)
        # R5B-05: the stored policy's order-up-to level S was chosen with the A3 costs (J5). The "current" policy
        # keeps THAT S, so a cost what-if re-prices the current policy instead of silently redesigning it.
        if holding_rate == pc.HOLDING_RATE_DAILY and order_cost == pc.ORDER_COST_C:
            eoq_a3 = eoq
        else:
            eoq_a3 = eoq_for(pc.HOLDING_RATE_DAILY, pc.ORDER_COST_C)
        # G-03: initial stock = round(mean of the 28 days before the first replayed review * (L + R))
        win = policy_backtest.INIT_STOCK_WINDOW
        hist = A_ok[:, max(0, off - win):off]
        no_hist = (~np.isnan(hist)).sum(axis=1) == 0
        init = policy_backtest.initial_stock_from_history(hist, L, R) if hist.shape[1] else np.zeros(int(ok.sum()))
        legacy = np.ceil(cm["q"][ok][:, 0]) + np.ceil(eoq_a3[:, 0])
        init = np.where(no_hist, legacy, init)
        return {
            "dem": dem[ok], "q": cm["q"][ok], "eoq": eoq, "eoq_a3": eoq_a3, "price": price_ok,
            "daily_price": p_day_ok, "reviews": reviews,
            "init": init, "n_init_legacy": int(no_hist.sum()),
            "n_items": int(ok.sum()), "n_fallback": int(cm["fallback"][ok].any(axis=1).sum()),
            "n_teacher": int(np.asarray(cm.get("teacher", np.zeros(cm["q"].shape, dtype=bool)))[ok].all(axis=1).sum()),
        }, None

    def run(self, db: Session, req: WhatIfRequest) -> WhatIfResponse:
        from app.services.calibrator_service import calibrator_service
        from app.services.optimization_service import optimization_service

        pc.sync_costs(db)  # demo.md §1.3: the configured h, b, c (the request's own rates still win)

        store_id = (req.store_id or "").strip()
        if not store_id or store_id.upper() in ("GLOBAL", "ALL"):
            raise _unprocessable("store_required", "The what-if simulation runs for ONE store (GLOBAL is not supported).")
        L, R = int(req.lead_time_days), int(req.review_period_days)
        origin = optimization_service._store_origin(db, store_id)
        o_idx = pc.date_to_day_index(origin)
        plan = self._replay_plan(db, store_id, L, o_idx, req.n_reviews)
        r_opts = plan["r_options"]
        if not plan["ok"].get(R, False):
            days = plan["reviews"].get(R) or []
            reason = (
                f"R = {R} is not supported for '{store_id}' with L = {L}: no window quantile with H = L + R = {L + R} "
                f"at every {'daily' if R == 1 else 'weekly'} review of the replay span "
                f"{pc.day_index_to_date(plan['start']).isoformat()} .. "
                f"{pc.day_index_to_date(plan['end'] - 1).isoformat()} ({len(days)} reviews); intermediate "
                "forecasts are never invented.")
            if R == 1:
                reason += (" Daily reviews need daily-origin teacher quantiles "
                           "(scripts/load_teacher_data.py --steps quantiles --daily-origins --horizons 4 10).")
            raise _unprocessable(
                "unsupported_review_period", reason,
                supported_review_period_days=r_opts, r_options=r_opts, supported_lead_time_days=[1, 3, 7],
                review_period_days=R, lead_time_days=L,
            )
        reviews = plan["reviews"][R]
        classes = [c.strip().upper() for c in (req.classes or pc.ALL_CLASSES)]
        bad = [c for c in classes if c not in pc.ALL_CLASSES]
        if bad:
            raise _unprocessable("unknown_class", f"Unknown ABC-XYZ classes: {bad}.")
        policies = req.policies or self.DEFAULT_POLICIES
        for p in policies:
            if not p.use_current and (p.m_g is None or p.kappa_g is None):
                raise _unprocessable("policy_params_missing",
                                     f"Policy '{p.policy_key}': m_g and kappa_g are required unless use_current is true.")

        # R5B-10: a database still holding the legacy placeholder price (every product = 1.0, before load_products
        # read sell_prices.csv) would give meaningless costs -> refuse instead of simulating with it.
        from sqlalchemy import func
        n_prod, n_placeholder = db.query(
            func.count(Product.item_id), func.sum(case((Product.price == 1.0, 1), else_=0))
        ).filter(Product.item_id.in_(
            db.query(SKUClassification.item_id).filter(SKUClassification.store_id == store_id)
        )).one()
        if n_prod and (n_placeholder or 0) >= 0.9 * n_prod:
            raise _unprocessable(
                "placeholder_prices",
                f"{int(n_placeholder)} of {int(n_prod)} products of '{store_id}' still have the legacy placeholder "
                "price 1.0: run scripts/load_products.py (M5 sell_prices.csv) before a cost what-if.")

        tau = float(req.tau) if req.tau is not None else float(
            optimization_service.get_service_level_config(db).default_service_level)
        tau = min(0.999, max(0.5, tau))
        thetas = calibrator_service.get_current_thetas(db, store_id, as_of=origin)
        stored = calibrator_service.resolve_policies(db, store_id)

        inputs: Dict[str, Dict[str, Any]] = {}
        skipped: List[WhatIfSkippedClass] = []
        for c in classes:
            data, skip = self._class_inputs(db, store_id, c, o_idx, req.n_reviews, tau, L, R,
                                            req.holding_rate, req.order_cost, reviews=reviews)
            if data is None:
                skipped.append(skip)
            else:
                inputs[c] = data
        if not inputs:
            raise _unprocessable(
                "insufficient_data",
                "No class of the store has replayable data (>= 2 stored review forecasts before the clock and SKUs "
                "with complete realised demand, quantiles and prices).",
                skipped_classes=[s.model_dump() for s in skipped], r_options=r_opts,
            )

        results: List[WhatIfPolicyResult] = []
        defaulted: set = set()
        for p in policies:
            by_class: List[WhatIfClassResult] = []
            for c, d in inputs.items():
                if p.use_current:
                    sel = stored.get(c)
                    has_m = sel is not None and sel.m_g is not None
                    has_k = sel is not None and sel.kappa_g is not None
                    m = float(sel.m_g) if has_m else 0.0
                    kappa = float(sel.kappa_g) if has_k else 1.0
                    params_source = "stored" if (has_m and has_k) else "default_no_stored_selection"
                    eoq = d["eoq_a3"]
                else:
                    m, kappa = float(p.m_g), float(p.kappa_g)
                    params_source = "request"
                    eoq = d["eoq"]
                if params_source == "default_no_stored_selection":
                    defaulted.add(c)
                theta = float(thetas.get(c, 0.0)) if p.use_theta else 0.0
                res = policy_backtest.simulate_rss_candidates(
                    d["dem"], d["q"], eoq, d["price"], [m], [kappa], theta=theta, lead_time=L, review_period=R,
                    holding_rate=req.holding_rate, stockout_rate=req.stockout_penalty_rate, order_cost=req.order_cost,
                    initial_on_hand=d["init"], daily_price=d["daily_price"],
                )
                by_class.append(WhatIfClassResult(
                    class_id=c, m_g=m, kappa_g=kappa, theta_g=round(theta, 4), params_source=params_source,
                    **self._metrics(res, d["n_items"]),
                ))
            results.append(WhatIfPolicyResult(
                policy_key=p.policy_key, label=p.label, overall=self._overall(by_class), by_class=by_class,
            ))

        all_reviews = sorted({r for d in inputs.values() for r in d["reviews"]})
        n_fb = sum(d["n_fallback"] for d in inputs.values())
        n_items = sum(d["n_items"] for d in inputs.values())
        n_teacher = sum(d["n_teacher"] for d in inputs.values())
        notes = [
            "Replay of past reviews before the simulated clock; quantiles are causal (no information after each review).",
            f"Replay span = {req.n_reviews} weekly periods; R = {R} gives {len(all_reviews)} reviews "
            f"({'one every day' if R == 1 else 'one every 7 days'}). Replayable R for L = {L}: {r_opts}.",
            f"{n_items} SKUs simulated; {n_fb} of them used the labelled Gaussian quantile fallback at >= 1 review "
            f"(fewer than {pc.MIN_RESIDUALS} matured residual windows).",
            "Theta (when applied) is the CURRENT C3-OUT state, frozen during the replay (no closed-loop update).",
            "The 'current' policy keeps the order-up-to level of the stored policy (EOQ with the A3 costs h = "
            f"{pc.HOLDING_RATE_DAILY}, c = {pc.ORDER_COST_C}); the requested h, b, c re-price it. Other policies use "
            "the requested h and c in their EOQ. EOQ = sqrt(2 c mu / (h p)), mu = mean actual sales of the "
            f"{pc.EOQ_MEAN_WINDOW_DAYS} days before each review, p = price of the review day (engine rule).",
        ]
        if defaulted:
            notes.append(
                f"No stored policy selection for class(es) {sorted(defaulted)}: the 'current' policy used the "
                "default m = 0, kappa = 1 there (params_source = default_no_stored_selection).")
        return WhatIfResponse(
            store_id=store_id, as_of=origin.isoformat(), lead_time_days=L, review_period_days=R, horizon_days=L + R,
            tau=tau, holding_rate=req.holding_rate, stockout_penalty_rate=req.stockout_penalty_rate,
            order_cost=req.order_cost, n_reviews=len(all_reviews),
            period_start=pc.day_index_to_date(all_reviews[0]).isoformat(),
            period_end=pc.day_index_to_date(all_reviews[-1] + R - 1).isoformat(),
            r_options=r_opts,
            quantile_basis=self._quantile_basis(L + R, n_teacher, n_items),
            initial_stock_basis=(
                f"round(mean sales of the {policy_backtest.INIT_STOCK_WINDOW} days before the first replayed review "
                f"x (L + R)), identical for every policy; ceil(Q_hat) + ceil(EOQ) for "
                f"{sum(d['n_init_legacy'] for d in inputs.values())} SKU(s) without sales in that window"
            ),
            policies=results, skipped_classes=skipped, notes=notes,
        )

    @staticmethod
    def _quantile_basis(H: int, n_teacher: int, n_items: int) -> str:
        parts = []
        if n_teacher:
            parts.append(f"imported teacher window quantiles (route '{pc.ROUTE_TEACHER}', H = L + R = {H}, origin = "
                         f"each review day) for {n_teacher} of {n_items} SKUs")
        if n_teacher < n_items:
            parts.append(
                f"causal route (c): forecast_backtest window forecast (W = {pc.BACKTEST_WINDOW_DAYS} days) x H/"
                f"{pc.BACKTEST_WINDOW_DAYS} with H = L + R = {H}, plus the empirical tau-quantile of residuals of "
                "matured realised H-day windows (o-364 <= s, s + H <= o)")
        return "; ".join(parts)

    @staticmethod
    def _metrics(res: policy_backtest.BacktestResult, n_items: int) -> Dict[str, Any]:
        av = float(res.availability[0]) if res.n_sku_periods else None
        return {
            "total_cost": round(float(res.cost[0]), 2), "holding_cost": round(float(res.holding[0]), 2),
            "shortage_cost": round(float(res.shortage[0]), 2), "ordering_cost": round(float(res.ordering[0]), 2),
            "orders": int(res.orders[0]) if res.orders is not None else 0,
            "availability": round(av, 5) if av is not None else None,
            "availability_pct": round(av * 100.0, 2) if av is not None else None,
            "fill_rate": round(float(res.fill_rate[0]), 5) if res.demand_units > 0 else None,
            "lost_units": round(float(res.lost_units[0]), 2) if res.lost_units is not None else 0.0,
            "demand_units": round(float(res.demand_units), 2), "n_items": n_items, "n_sku_periods": res.n_sku_periods,
        }

    @staticmethod
    def _overall(by_class: List[WhatIfClassResult]) -> WhatIfMetrics:
        periods = sum(c.n_sku_periods for c in by_class)
        demand = sum(c.demand_units for c in by_class)
        lost = sum(c.lost_units for c in by_class)
        avail = (sum((c.availability or 0.0) * c.n_sku_periods for c in by_class) / periods) if periods else None
        return WhatIfMetrics(
            total_cost=round(sum(c.total_cost for c in by_class), 2),
            holding_cost=round(sum(c.holding_cost for c in by_class), 2),
            shortage_cost=round(sum(c.shortage_cost for c in by_class), 2),
            ordering_cost=round(sum(c.ordering_cost for c in by_class), 2),
            orders=sum(c.orders for c in by_class),
            availability=round(avail, 5) if avail is not None else None,
            availability_pct=round(avail * 100.0, 2) if avail is not None else None,
            fill_rate=round(1.0 - lost / demand, 5) if demand > 0 else None,
            lost_units=round(lost, 2), demand_units=round(demand, 2),
            n_items=sum(c.n_items for c in by_class), n_sku_periods=periods,
        )


what_if_service = WhatIfService()
