"""G-37 sandbox loader: the teacher's DAILY price (``price.npy``, (8831, 1941) float32) of ONE store into
``price_history`` of the LOCAL sandbox database.

Rows: one per (store, item, day) for the day indices [start_day, T_END) (default 1031..1940, the span of the sales
loaded by load_teacher_data.py), calendar date = 2011-01-29 + index, price = price.npy[row, day]. The rows of the
store in that date range are replaced (idempotent). PostgreSQL: COPY; sqlite: executemany.

With these rows the engine values EOQ at the price of the review day and J5 candidate costs (holding = end-of-day
stock * price of that day, lost units * price of that day) like the teacher; without them it keeps products.price.

SAFETY: refuses to run unless DATABASE_URL is sqlite or a PostgreSQL URL on localhost/127.0.0.1 whose database name
starts with ``dfios_sandbox``. The teacher folder is only read (numpy mmap / parquet).

    DATABASE_URL=postgresql+psycopg2://USER:PWD@localhost:5432/dfios_sandbox_f2 DFIOS_LOCAL_ONLY=1 \
        python scripts/load_teacher_prices.py --store CA_1
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from io import StringIO
from typing import Dict, Optional
from urllib.parse import urlparse

sys.dont_write_bytecode = True
BE_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SCRIPTS = os.path.dirname(os.path.abspath(__file__))
for _p in (BE_DIR, SCRIPTS):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import numpy as np  # noqa: E402

from load_teacher_data import SANDBOX_HOSTS, day_to_date  # noqa: E402

SANDBOX_PREFIX = "dfios_sandbox"


def assert_sandbox_prefix_url(url: Optional[str]) -> str:
    """Return the URL if it is sqlite or a local PostgreSQL database whose name starts with ``dfios_sandbox``."""
    url = (url or "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL is not set; refusing to guess a database")
    if url.lower().startswith("sqlite"):
        return url
    p = urlparse(url.replace("+psycopg2", "").replace("+psycopg", ""))
    if not (p.scheme or "").startswith("postgres"):
        raise RuntimeError(f"refusing: unsupported database scheme '{p.scheme}'")
    host = (p.hostname or "").lower()
    db = (p.path or "").lstrip("/")
    if host not in SANDBOX_HOSTS:
        raise RuntimeError(f"refusing: database host '{host}' is not localhost/127.0.0.1")
    if not db.startswith(SANDBOX_PREFIX):
        raise RuntimeError(f"refusing: database '{db}' does not start with '{SANDBOX_PREFIX}'")
    return url


def read_prices(teacher_dir: str, store: str, start_day: int):
    """(item_ids, price (n, days) float64, start_day, T_END) of the store's rows (read-only mmap)."""
    import pandas as pd

    prep = os.path.join(teacher_dir, "c3out_experiments", "data", "m5_prepared")
    with open(os.path.join(prep, "info.json"), encoding="utf-8") as f:
        T = int(json.load(f)["T_END"])
    meta = pd.read_parquet(os.path.join(prep, "meta.parquet"), columns=["item_id", "store_id"])
    rows = np.flatnonzero(meta["store_id"].values == store)
    if not len(rows):
        raise ValueError(f"store {store} not in the teacher's meta.parquet")
    if rows[-1] - rows[0] + 1 != len(rows):
        raise ValueError("store rows are not contiguous in meta.parquet")
    sl = slice(int(rows[0]), int(rows[-1]) + 1)
    price = np.asarray(np.load(os.path.join(prep, "price.npy"), mmap_mode="r")[sl, start_day:T], dtype=np.float64)
    return meta["item_id"].astype(str).values[sl].tolist(), price, start_day, T


def load_prices(db, store: str, item_ids, price: np.ndarray, start_day: int) -> Dict[str, object]:
    from sqlalchemy import delete
    from app.models.price_history import PriceHistory

    n, D = price.shape
    if n != len(item_ids):
        raise ValueError("price rows and item_ids differ")
    if not np.isfinite(price).all() or (price <= 0).any():
        raise ValueError("price.npy slice has NaN / non-positive values")
    dates = [day_to_date(start_day + j) for j in range(D)]
    conn = db.connection()
    deleted = conn.execute(delete(PriceHistory.__table__).where(
        PriceHistory.store_id == store, PriceHistory.date >= dates[0], PriceHistory.date <= dates[-1])).rowcount
    if conn.dialect.name == "postgresql":
        raw = conn.connection.driver_connection
        ds = [d.isoformat() for d in dates]
        step = max(1, 500_000 // max(D, 1))
        for k in range(0, n, step):
            buf = StringIO()
            w = csv.writer(buf)
            for i in range(k, min(n, k + step)):
                iid = item_ids[i]
                pr = price[i]
                for j in range(D):
                    w.writerow((store, iid, ds[j], repr(float(pr[j]))))
            buf.seek(0)
            with raw.cursor() as cur:
                cur.copy_expert('COPY price_history (store_id, item_id, "date", price) FROM STDIN WITH (FORMAT CSV)',
                                buf)
    else:
        rows = [{"store_id": store, "item_id": item_ids[i], "date": d, "price": float(price[i, j])}
                for i in range(n) for j, d in enumerate(dates)]
        for k in range(0, len(rows), 20_000):
            conn.execute(PriceHistory.__table__.insert(), rows[k:k + 20_000])
    db.commit()
    return {"store": store, "rows": n * D, "items": n, "days": D, "deleted_before": int(deleted or 0),
            "first_date": dates[0].isoformat(), "last_date": dates[-1].isoformat(),
            "price_min": float(price.min()), "price_max": float(price.max())}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--teacher-dir", default=os.environ.get("TEACHER_DIR", r"C:\DATN\26FA_SET490_Inventory"))
    ap.add_argument("--store", default="CA_1")
    ap.add_argument("--start-day", type=int, default=1031)
    ap.add_argument("--report", default=None)
    args = ap.parse_args(argv)

    url = assert_sandbox_prefix_url(os.environ.get("DATABASE_URL"))
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.core.schema_upgrades import apply_schema_upgrades
    from app.models.base import Base
    import app.models  # noqa: F401  (register every table)

    engine = create_engine(url)
    Base.metadata.create_all(bind=engine, checkfirst=True)
    upgrades = apply_schema_upgrades(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    t0 = time.time()
    try:
        item_ids, price, s0, _T = read_prices(args.teacher_dir, args.store, args.start_day)
        rep = load_prices(db, args.store, item_ids, price, s0)
    finally:
        db.close()
    rep["schema_upgrades"] = upgrades
    rep["seconds"] = round(time.time() - t0, 1)
    if args.report:
        with open(args.report, "w", encoding="utf-8") as f:
            json.dump(rep, f, indent=1)
    print(json.dumps(rep, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
