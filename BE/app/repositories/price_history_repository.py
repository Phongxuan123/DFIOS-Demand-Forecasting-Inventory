"""Daily price lookups (G-37): ``price_history`` first, ``products.price`` as the fallback.

Every helper returns prices aligned with the given ``item_ids``. A (item, date) without a ``price_history`` row gets
the item's constant ``products.price`` (``fallback``); an item without either gets NaN, so the callers keep their own
rule for unpriced items. When the store has no ``price_history`` row at all no daily query is made, so the feature is
a no-op on databases that never loaded daily prices.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Dict, Mapping, Sequence

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.price_history import PriceHistory
from app.models.product import Product

_CHUNK = 900


def has_prices(db: Session, store_id: str) -> bool:
    """True when the store has at least one daily price row."""
    return db.execute(
        select(PriceHistory.item_id).where(PriceHistory.store_id == store_id).limit(1)
    ).first() is not None


def constant_prices(db: Session, item_ids: Sequence[str]) -> np.ndarray:
    """``products.price`` aligned with ``item_ids`` (NaN when the product is missing, its price is NULL or <= 0)."""
    pos = {i: k for k, i in enumerate(item_ids)}
    out = np.full(len(item_ids), np.nan)
    ids = list(pos)
    for k in range(0, len(ids), _CHUNK):
        for iid, p in db.execute(
            select(Product.item_id, Product.price).where(Product.item_id.in_(ids[k:k + _CHUNK]))
        ).all():
            if p is not None and float(p) > 0:
                out[pos[iid]] = float(p)
    return out


def _fallback_array(db: Session, item_ids: Sequence[str], fallback) -> np.ndarray:
    if fallback is None:
        return constant_prices(db, item_ids)
    if isinstance(fallback, Mapping):
        return np.array([float(fallback[i]) if fallback.get(i) is not None else np.nan for i in item_ids])
    arr = np.asarray(fallback, dtype=float)
    if arr.shape != (len(item_ids),):
        raise ValueError("fallback must be aligned with item_ids")
    return arr.copy()


def price_matrix(
    db: Session, store_id: str, item_ids: Sequence[str], start: date, end_excl: date, fallback=None,
) -> np.ndarray:
    """(n_items, days) price of every day of [start, end_excl): the ``price_history`` row of that (item, day) when
    present, else the item's fallback price (``products.price`` unless ``fallback`` is given)."""
    n = len(item_ids)
    T = max(0, (end_excl - start).days)
    base = _fallback_array(db, item_ids, fallback)
    M = np.repeat(base[:, None], T, axis=1) if T else np.zeros((n, 0))
    if T == 0 or n == 0 or not has_prices(db, store_id):
        return M
    pos = {i: k for k, i in enumerate(item_ids)}
    ids = list(pos)
    for k in range(0, len(ids), _CHUNK):
        for iid, d, p in db.execute(
            select(PriceHistory.item_id, PriceHistory.date, PriceHistory.price).where(
                PriceHistory.store_id == store_id, PriceHistory.date >= start, PriceHistory.date < end_excl,
                PriceHistory.item_id.in_(ids[k:k + _CHUNK]))
        ).all():
            if p is not None and float(p) > 0:
                M[pos[iid], (d - start).days] = float(p)
    return M


def price_on(db: Session, store_id: str, item_ids: Sequence[str], day: date, fallback=None) -> np.ndarray:
    """(n_items,) price of ``day`` (daily row, else fallback)."""
    return price_matrix(db, store_id, item_ids, day, day + timedelta(days=1), fallback)[:, 0] if item_ids else \
        np.zeros(0)


def price_map_on(db: Session, store_id: str, item_ids: Sequence[str], day: date, fallback=None) -> Dict[str, float]:
    """{item_id: price of ``day``} for the items with a known price (daily row or positive fallback)."""
    arr = price_on(db, store_id, list(item_ids), day, fallback)
    return {i: float(p) for i, p in zip(item_ids, arr) if not np.isnan(p)}
