"""
FR10 what-if: a REAL re-simulation of (R, s, S) policies on the store's own history (research.md 7.2-7.4).

For every ABC-XYZ class of the store the last ``n_reviews`` consecutive reviews before the simulated clock are
replayed with the vectorised lost-sales backtest of ``policy_backtest`` (the engine of job J5):

* Q_hat_tau at each review = causal route-(c) quantile from ``forecast_backtest`` (window forecast of that review +
  empirical residual quantile of matured H-day windows, H = L + R; labelled Gaussian fallback below 8 residuals).
  Nothing after a review is used to compute its quantile; nothing after the clock is used at all.
* daily demand = realised sales of the replayed days (sales_history / M5 CSV); an item missing ANY replayed day,
  any review quantile or a price is excluded (never zero-filled, never an invented price);
* s = ceil(Q_hat * e^(m_g [+ theta_g])), S = s + ceil(kappa_g * EOQ), EOQ from the review's point forecast with the
  user's h and c; order S - IP when IP <= s, arrival L days later; costs h*price*end-of-day stock + b*price*lost
  units + c per order line; availability = share of SKU-periods without a zero-stock day (observed, 8.1).

Constraints (answered with 422 + reason, never approximated):
* R must equal the spacing of the stored causal review forecasts (weekly, 7 days): R = 1 would need daily
  review forecasts that do not exist;
* L in {1, 3, 7} (schema), H = L + R; the stored window forecasts are 10-day sums (W = 10), rescaled by H / 10;
  the residual quantile is measured on realised H-day windows, so the calibration is empirical for that H;
* a class needs >= 2 replayable reviews and >= 1 complete item.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.classification import SKUClassification
from app.models.forecast_backtest import ForecastBacktest
from app.models.product import Product
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

    @staticmethod
    def _review_spacing(db: Session, store_id: str) -> Optional[int]:
        days = [r[0] for r in db.query(ForecastBacktest.review_day)
                .filter(ForecastBacktest.store_id == store_id).distinct().order_by(ForecastBacktest.review_day).all()]
        if len(days) < 2:
            return None
        gaps = np.diff(np.array(days[-60:], dtype=int))
        vals, counts = np.unique(gaps, return_counts=True)
        return int(vals[np.argmax(counts)])

    def _class_inputs(
        self, db: Session, store_id: str, class_id: str, o_idx: int, n_reviews: int, tau: float, L: int, R: int,
        holding_rate: float, order_cost: float,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[WhatIfSkippedClass]]:
        from app.services.optimization_service import optimization_service

        item_ids = [r[0] for r in db.query(SKUClassification.item_id)
                    .filter(SKUClassification.store_id == store_id, SKUClassification.segment == class_id)
                    .order_by(SKUClassification.item_id).all()]
        if not item_ids:
            return None, WhatIfSkippedClass(class_id=class_id, reason_code="no_items",
                                            reason="No classified SKU in this class for the store.")
        reviews = optimization_service._validation_reviews(db, store_id, item_ids, o_idx, n_reviews)
        if len(reviews) < 2:
            return None, WhatIfSkippedClass(
                class_id=class_id, reason_code="too_few_reviews",
                reason=f"Fewer than 2 consecutive stored review forecasts (spacing {R} days) before the clock.")
        H = L + R
        cm = window_quantile_service.causal_quantile_matrix(db, store_id, item_ids, reviews, tau, H)
        A = build_actuals_matrix(db, store_id, item_ids, reviews[0], reviews[-1] + R)
        prices = {p.item_id: p.price for p in db.query(Product).filter(Product.item_id.in_(item_ids)).all()}
        price = np.array([float(prices[i]) if prices.get(i) and float(prices[i]) > 0 else np.nan for i in item_ids])
        days_idx = np.concatenate([np.arange(s - reviews[0], s - reviews[0] + R) for s in reviews])
        dem = A[:, days_idx]
        ok = ~np.isnan(dem).any(axis=1) & ~np.isnan(cm["q"]).any(axis=1) & ~np.isnan(price)
        if not ok.any():
            return None, WhatIfSkippedClass(
                class_id=class_id, reason_code="no_complete_items",
                reason="No SKU has realised demand on every replayed day, a quantile at every review and a price.")
        point, price_ok = cm["point"][ok], price[ok]
        eoq = np.stack([policy_backtest.eoq_units(point[:, k] / H, price_ok, holding_rate, order_cost)
                        for k in range(len(reviews))], axis=1)
        return {
            "dem": dem[ok], "q": cm["q"][ok], "eoq": eoq, "price": price_ok, "reviews": reviews,
            "n_items": int(ok.sum()), "n_fallback": int(cm["fallback"][ok].any(axis=1).sum()),
        }, None

    def run(self, db: Session, req: WhatIfRequest) -> WhatIfResponse:
        from app.services.calibrator_service import calibrator_service
        from app.services.optimization_service import optimization_service

        store_id = (req.store_id or "").strip()
        if not store_id or store_id.upper() in ("GLOBAL", "ALL"):
            raise _unprocessable("store_required", "The what-if simulation runs for ONE store (GLOBAL is not supported).")
        L, R = int(req.lead_time_days), int(req.review_period_days)
        spacing = self._review_spacing(db, store_id)
        if spacing is None:
            raise _unprocessable(
                "no_review_forecasts",
                f"Store '{store_id}' has no stored causal review forecasts (forecast_backtest): nothing to replay.")
        if R != spacing:
            raise _unprocessable(
                "unsupported_review_period",
                f"R = {R} is not supported: the stored causal review forecasts of '{store_id}' are spaced {spacing} "
                f"days apart, so only R = {spacing} can be replayed without inventing intermediate forecasts.",
                supported_review_period_days=[spacing], supported_lead_time_days=[1, 3, 7],
            )
        classes = [c.strip().upper() for c in (req.classes or pc.ALL_CLASSES)]
        bad = [c for c in classes if c not in pc.ALL_CLASSES]
        if bad:
            raise _unprocessable("unknown_class", f"Unknown ABC-XYZ classes: {bad}.")
        policies = req.policies or self.DEFAULT_POLICIES
        for p in policies:
            if not p.use_current and (p.m_g is None or p.kappa_g is None):
                raise _unprocessable("policy_params_missing",
                                     f"Policy '{p.policy_key}': m_g and kappa_g are required unless use_current is true.")

        origin = optimization_service._store_origin(db, store_id)
        o_idx = pc.date_to_day_index(origin)
        tau = float(req.tau) if req.tau is not None else float(
            optimization_service.get_service_level_config(db).default_service_level)
        tau = min(0.999, max(0.5, tau))
        thetas = calibrator_service.get_current_thetas(db, store_id, as_of=origin)
        stored = calibrator_service.resolve_policies(db, store_id)

        inputs: Dict[str, Dict[str, Any]] = {}
        skipped: List[WhatIfSkippedClass] = []
        for c in classes:
            data, skip = self._class_inputs(db, store_id, c, o_idx, req.n_reviews, tau, L, R,
                                            req.holding_rate, req.order_cost)
            if data is None:
                skipped.append(skip)
            else:
                inputs[c] = data
        if not inputs:
            raise _unprocessable(
                "insufficient_data",
                "No class of the store has replayable data (>= 2 stored review forecasts before the clock and SKUs "
                "with complete realised demand, quantiles and prices).",
                skipped_classes=[s.model_dump() for s in skipped],
            )

        results: List[WhatIfPolicyResult] = []
        for p in policies:
            by_class: List[WhatIfClassResult] = []
            for c, d in inputs.items():
                if p.use_current:
                    sel = stored.get(c)
                    m = float(sel.m_g) if sel is not None and sel.m_g is not None else 0.0
                    kappa = float(sel.kappa_g) if sel is not None and sel.kappa_g is not None else 1.0
                else:
                    m, kappa = float(p.m_g), float(p.kappa_g)
                theta = float(thetas.get(c, 0.0)) if p.use_theta else 0.0
                res = policy_backtest.simulate_rss_candidates(
                    d["dem"], d["q"], d["eoq"], d["price"], [m], [kappa], theta=theta, lead_time=L, review_period=R,
                    holding_rate=req.holding_rate, stockout_rate=req.stockout_penalty_rate, order_cost=req.order_cost,
                )
                by_class.append(WhatIfClassResult(
                    class_id=c, m_g=m, kappa_g=kappa, theta_g=round(theta, 4),
                    **self._metrics(res, d["n_items"]),
                ))
            results.append(WhatIfPolicyResult(
                policy_key=p.policy_key, label=p.label, overall=self._overall(by_class), by_class=by_class,
            ))

        all_reviews = sorted({r for d in inputs.values() for r in d["reviews"]})
        n_fb = sum(d["n_fallback"] for d in inputs.values())
        n_items = sum(d["n_items"] for d in inputs.values())
        notes = [
            "Replay of past reviews before the simulated clock; quantiles are causal (no information after each review).",
            f"{n_items} SKUs simulated; {n_fb} of them used the labelled Gaussian quantile fallback at >= 1 review "
            f"(fewer than {pc.MIN_RESIDUALS} matured residual windows).",
            "Theta (when applied) is the CURRENT C3-OUT state, frozen during the replay (no closed-loop update).",
        ]
        return WhatIfResponse(
            store_id=store_id, as_of=origin.isoformat(), lead_time_days=L, review_period_days=R, horizon_days=L + R,
            tau=tau, holding_rate=req.holding_rate, stockout_penalty_rate=req.stockout_penalty_rate,
            order_cost=req.order_cost, n_reviews=len(all_reviews),
            period_start=pc.day_index_to_date(all_reviews[0]).isoformat(),
            period_end=pc.day_index_to_date(all_reviews[-1] + R - 1).isoformat(),
            quantile_basis=(
                f"causal route (c): forecast_backtest window forecast (W = {pc.BACKTEST_WINDOW_DAYS} days) x H/"
                f"{pc.BACKTEST_WINDOW_DAYS} with H = L + R = {L + R}, plus the empirical tau-quantile of residuals of "
                f"matured realised H-day windows (o-364 <= s, s + H <= o)"
            ),
            initial_stock_basis="ceil(Q_hat) + ceil(EOQ) of the first replayed review, identical for every policy",
            policies=results, skipped_classes=skipped, notes=notes,
        )

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
