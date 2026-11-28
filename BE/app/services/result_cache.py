"""Result cache of the slow read endpoints, keyed by a fingerprint of the data they read (research_v2 H5 / O3).

``metrics/forecast-quality`` and ``optimization/compare-static`` recompute everything from the database on every call
(3-5 s). Their inputs only change when the clock advances, quantiles / parameters / settings are rewritten, products
or sales are imported, so the response is kept per (endpoint, arguments, fingerprint) and served again while the
fingerprint is unchanged. ``warm_in_background`` precomputes the expensive pieces (DB-causal coverage, the default
forecast-quality and compare-static) after start-up and after each clock advance, so the first call after either is
fast too.
"""
from __future__ import annotations

import logging
import os
import sys
import threading
from collections import OrderedDict
from typing import Any, Callable, Hashable, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

MAX_ENTRIES = 64
_lock = threading.Lock()
_entries: "OrderedDict[Hashable, Any]" = OrderedDict()
_warming = threading.Lock()


def fingerprint(db: Session, store_id: Optional[str]) -> Tuple:
    """Cheap identity of everything the cached endpoints read for a store (aggregate queries on indexed columns)."""
    from app.models.forecast_window_quantile import ForecastWindowQuantile as FWQ
    from app.models.inventory_param import InventoryParam
    from app.models.product import Product
    from app.models.sales_history import SalesHistory
    from app.models.sim_clock import SimClock
    from app.models.system_setting import SystemSetting

    def scoped(q, col):
        return q.filter(col == store_id) if store_id else q

    clock = scoped(db.query(func.max(SimClock.current_date), func.max(SimClock.updated_at)), SimClock.store_id).one()
    fwq = scoped(db.query(func.count(FWQ.id), func.max(FWQ.created_at)), FWQ.store_id).one()
    params = scoped(db.query(func.count(InventoryParam.id), func.max(InventoryParam.updated_at)),
                    InventoryParam.store_id).one()
    sales = scoped(db.query(func.max(SalesHistory.sale_date)), SalesHistory.store_id).scalar()
    settings = db.query(func.max(SystemSetting.updated_at)).scalar()
    products = db.query(func.count(Product.item_id)).scalar()
    return tuple(str(x) for x in (*clock, *fwq, *params, sales, settings, products))


def cached(db: Session, name: str, store_id: Optional[str], args: Tuple, compute: Callable[[], Any]) -> Any:
    """``compute()`` once per (name, store, args, data fingerprint); later calls with the same data return it."""
    key = (name, store_id, args, fingerprint(db, store_id))
    with _lock:
        if key in _entries:
            _entries.move_to_end(key)
            return _entries[key]
    value = compute()
    with _lock:
        _entries[key] = value
        while len(_entries) > MAX_ENTRIES:
            _entries.popitem(last=False)
    return value


def clear() -> None:
    with _lock:
        _entries.clear()


def warmup_enabled() -> bool:
    if os.getenv("DFIOS_WARMUP", "1").strip().lower() in ("0", "false", "no"):
        return False
    return "pytest" not in sys.modules and "PYTEST_CURRENT_TEST" not in os.environ


def warm(store_ids: Optional[list] = None) -> None:
    """Precompute the coverage (both report scopes) and the default slow responses of every store with a clock."""
    from app.core.database import SessionLocal
    from app.models.sim_clock import SimClock
    from app.services import coverage_service
    from app.services.optimization_service import optimization_service
    from app.services.quality_metrics_service import forecast_quality_from_db

    with SessionLocal() as db:
        stores = store_ids or [r[0] for r in db.query(SimClock.store_id).distinct().all()]
        coverage_service.db_causal_coverage_q95(db, None)
        for sid in stores:
            coverage_service.db_causal_coverage_q95(db, sid)
            forecast_quality_cached(db, sid, forecast_quality_from_db)
            cached(db, "compare-static", sid, (), lambda: optimization_service.compare_ml_vs_static(db, store_id=sid))


def forecast_quality_cached(db: Session, store_id: str, fn: Callable, *args) -> Any:
    """The default forecast-quality call (the one the UI makes) through the cache."""
    from app.services import policy_config as pc
    defaults = (pc.HORIZON_DAYS, None, None, None, 60, 500, None)
    params = args or defaults
    return cached(db, "forecast-quality", store_id, tuple(str(a) for a in params), lambda: fn(db, store_id, *params))


def warm_in_background(store_ids: Optional[list] = None) -> bool:
    """Start ``warm`` on a daemon thread (at most one at a time); False when disabled or already running."""
    if not warmup_enabled() or not _warming.acquire(blocking=False):
        return False

    def run():
        import time
        t0 = time.perf_counter()
        try:
            warm(store_ids)
            logger.warning("Cache warm-up done in %.1fs", time.perf_counter() - t0)
        except Exception:  # noqa: BLE001 - a warm-up must never take the API down; the next call computes it
            logger.warning("cache warm-up failed", exc_info=True)
        finally:
            _warming.release()

    threading.Thread(target=run, name="dfios-warmup", daemon=True).start()
    return True
