"""P2 sandbox loader: the teacher's prepared M5 data for ONE store (default CA_1) into the LOCAL sandbox database.

What it writes (idempotent; every step can be re-run):
  classes    sku_classifications of the store from ``meta.abcxyz_merged`` (class_source = 'teacher_meta'). The labels
             are the teacher's POOLED 3-store labels kept as-is: in CA_1 the class CX has only 3 SKUs (the teacher's
             merge_small(min 15) runs on the 8,831-SKU pool, where CX has 15, so it is not merged). Store SKUs that the
             teacher dropped are removed from the store's classification (they have no teacher demand / quantiles).
  sales      sales_history: one row per (SKU, day) for day indices [start_day, T_END) (zeros included), calendar
             date = 2011-01-29 + index; upsert on (id, sale_date).
  prices     products.price := teacher mean_price ONLY where the product has no positive price. NOTE: the app has no
             daily price table, so the engine prices every day with the constant products.price (the teacher uses the
             daily ``price.npy``).
  quantiles  forecast_window_quantile: for each review day t_k = VAL_START + R*k (k = 0..77) the teacher ensemble
             window quantiles Q_{L+R}(tau) (19 levels, 0.95 = level index 10) for the window [t_k, t_k + 10), stored in
             the shape J3 reads (model_run_id = backtest-ensemble-v1, horizon_days = 10, q_levels {"0.95": ...}),
             route = 'teacher' (J5 scores its candidates on these rows, see window_quantile_service).
             Model-switch scenario (teacher E6/E9c, ``--switch-from A --switch-to B --switch-day 1759``): reviews
             with day < switch-day get model A's quantiles, reviews with day >= switch-day model B's, all under the
             same model_run_id / route = 'teacher' (the engine does not know a switch happened; J5's 91-day refits
             are the only re-tuning). Per model the first folder among DFIOS/results/forecasts,
             c3out_experiments/results/m5/forecasts, c3out_experiments/results/revision/forecasts and
             c3out_bundle/results/m5/forecasts whose Q_H10 covers every review day is used.
             Daily origins (``--daily-origins --horizons 4 10``): instead of the weekly reviews, Q_H at EVERY day
             t = VAL_START .. T_END - 1 for each H (H = L + R: 4 for the what-if with R = 1, 10 for R = 7), same
             model_run_id / route; origins that already hold teacher rows for every SKU at that H (the weekly
             H = 10 rows) are kept, never duplicated (see ``load_daily_quantiles``).
  sources    (optional, --steps sources --source-models ensemble chronos_bolt) every model's window quantiles at the
             review origins into window_quantile_source, the input of the Admin model switch
             (POST /forecast-sources/activate, demo.md step 10). The engine never reads this table.
  clock      sim_clock(store) start = current = TEST_START (2015-05-25; --clock-start-day 1395 = 2014-11-24 for the
             teacher's continuous run, with --refit-as-of-day 1577 for selection #0), the store's simulation state is cleared
             (snapshot, shadow, service outcomes, inventory_daily, simulator orders, C3 states k >= 1, store-scoped
             J5 selections), theta_0 = 0 for the 9 classes, initial stock round(mean 28 days * (L+R)) and, unless
             --no-initial-refit, a J5 selection at the clock start (window 26 weeks before it, teacher selection #0)
             saved as ``<store>_refit_0``.

SAFETY: refuses to run unless DATABASE_URL is sqlite or a PostgreSQL URL on localhost/127.0.0.1 whose database name
starts with ``dfios_sandbox`` (e.g. ``dfios_sandbox``, ``dfios_sandbox_f3``). The teacher folder is only read (numpy mmap / parquet).

    DATABASE_URL=postgresql+psycopg2://USER:PWD@localhost:5432/dfios_sandbox DFIOS_LOCAL_ONLY=1 \
        python scripts/load_teacher_data.py --store CA_1
    # model switch chronos_bolt -> ensemble at day 1759 (2015-11-23): quantiles + clock reset only
    python scripts/load_teacher_data.py --store CA_1 --steps quantiles clock \
        --switch-from chronos_bolt --switch-to ensemble --switch-day 1759
    # daily-origin window quantiles for the what-if with R = 1 (H = 4) and R = 7 (H = 10)
    python scripts/load_teacher_data.py --store CA_1 --steps quantiles --daily-origins --horizons 4 10
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Sequence
from urllib.parse import urlparse

sys.dont_write_bytecode = True
BE_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
if BE_DIR not in sys.path:
    sys.path.insert(0, BE_DIR)

import numpy as np  # noqa: E402

from app.services import policy_config as pc  # noqa: E402

SANDBOX_DB = "dfios_sandbox"
SANDBOX_HOSTS = ("localhost", "127.0.0.1")
DAY0 = date(2011, 1, 29)  # the M5 calendar; day_to_date follows pc.M5_DAY0 (a shifted replay DB, see main)
VAL_START, TEST_START, T_END = 1395, 1577, 1941
L_DEFAULT, R_DEFAULT = 3, 7
QUANTILE_LEVELS = (0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.925, 0.95, 0.96, 0.97, 0.975, 0.98, 0.985,
                   0.99, 0.995, 0.999)
CLASS_SOURCE_TEACHER = "teacher_meta"
STEPS = ("classes", "sales", "prices", "quantiles", "clock")
# optional, never in the default run: per-model source quantiles for the in-app model switch (forecast_source_service)
OPTIONAL_STEPS = ("sources",)


# --------------------------------------------------------------------------- safety
def assert_sandbox_url(url: Optional[str]) -> str:
    """Return the URL if it is sqlite or a local PostgreSQL database named ``dfios_sandbox*``; raise otherwise."""
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
    if not db.startswith(SANDBOX_DB):
        raise RuntimeError(f"refusing: database '{db}' does not start with '{SANDBOX_DB}'")
    return url


def day_to_date(idx: int) -> date:
    return pc.M5_DAY0 + timedelta(days=int(idx))


# --------------------------------------------------------------------------- teacher data (read-only)
FORECAST_SUBDIRS = (("DFIOS", "results", "forecasts"), ("c3out_experiments", "results", "m5", "forecasts"),
                    ("c3out_experiments", "results", "revision", "forecasts"),
                    ("c3out_bundle", "results", "m5", "forecasts"))


def resolve_forecast_dir(teacher_dir: str, model: str, reviews: np.ndarray, H: int) -> str:
    """First forecast folder of ``model`` whose ``Q_H{H}.npy`` + ``origins.npy`` cover every review day."""
    tried = []
    for sub in FORECAST_SUBDIRS:
        d = os.path.join(teacher_dir, *sub, model)
        if not (os.path.isfile(os.path.join(d, "origins.npy")) and os.path.isfile(os.path.join(d, f"Q_H{H}.npy"))):
            continue
        origins = np.load(os.path.join(d, "origins.npy"))
        if np.isin(reviews, origins).all():
            return d
        tried.append(d)
    raise FileNotFoundError(f"no Q_H{H} of model {model!r} covering the review days under {teacher_dir}"
                            + (f" (incomplete: {tried})" if tried else ""))


def review_quantiles(teacher_dir: str, model: str, sl: slice, reviews: np.ndarray, H: int):
    """((K, n, 19) window quantiles of ``model`` at the review days for the store rows ``sl``, folder) (mmap)."""
    fdir = resolve_forecast_dir(teacher_dir, model, reviews, H)
    origins = np.load(os.path.join(fdir, "origins.npy"))
    idx = np.searchsorted(origins, reviews)
    qa = np.load(os.path.join(fdir, f"Q_H{H}.npy"), mmap_mode="r")
    if qa.ndim != 3 or qa.shape[2] != len(QUANTILE_LEVELS) or qa.shape[0] != len(origins):
        raise ValueError(f"unexpected {fdir}/Q_H{H} shape {qa.shape}")
    return np.stack([np.asarray(qa[int(o), sl, :], dtype=np.float64) for o in idx]), fdir


def read_teacher(teacher_dir: str, store: str = "CA_1", model: str = "ensemble", start_day: int = 1031,
                 L: int = L_DEFAULT, R: int = R_DEFAULT, switch_from: Optional[str] = None,
                 switch_to: Optional[str] = None, switch_day: Optional[int] = None) -> Dict[str, object]:
    """Read the store's rows of y / price / meta and the (L+R)-window quantiles at the review origins (mmap).

    With ``switch_from``/``switch_to`` the quantiles of reviews with day >= ``switch_day`` (default
    TEST_START + 182) come from ``switch_to`` and the earlier ones from ``switch_from``; ``model`` is ignored."""
    import pandas as pd

    prep = os.path.join(teacher_dir, "c3out_experiments", "data", "m5_prepared")
    with open(os.path.join(prep, "info.json"), encoding="utf-8") as f:
        info = json.load(f)
    val, test, T = int(info["VAL_START"]), int(info["TEST_START"]), int(info["T_END"])
    meta = pd.read_parquet(os.path.join(prep, "meta.parquet"))
    rows = np.flatnonzero(meta["store_id"].values == store)
    if not len(rows):
        raise ValueError(f"store {store} not in the teacher's meta.parquet")
    if rows[-1] - rows[0] + 1 != len(rows):
        raise ValueError("store rows are not contiguous in meta.parquet")
    sl = slice(int(rows[0]), int(rows[-1]) + 1)
    y = np.asarray(np.load(os.path.join(prep, "y.npy"), mmap_mode="r")[sl, start_day:T], dtype=np.float64)
    price = np.asarray(np.load(os.path.join(prep, "price.npy"), mmap_mode="r")[sl, start_day:T], dtype=np.float64)
    sub = meta.iloc[sl].reset_index(drop=True)

    reviews = np.arange(val, T, R)
    H = L + R
    switch = None
    if switch_from or switch_to:
        if not (switch_from and switch_to):
            raise ValueError("--switch-from and --switch-to go together")
        sday = int(switch_day if switch_day is not None else test + 182)
        if not (val < sday < T):
            raise ValueError(f"switch day {sday} outside ({val}, {T})")
        qa, dir_a = review_quantiles(teacher_dir, switch_from, sl, reviews, H)
        qb, dir_b = review_quantiles(teacher_dir, switch_to, sl, reviews, H)
        after = reviews >= sday
        q = np.where(after[:, None, None], qb, qa)  # (K, n, 19)
        model = f"{switch_from}->{switch_to}"
        switch = {"from": switch_from, "to": switch_to, "day": sday, "date": day_to_date(sday).isoformat(),
                  "first_review_after": int(reviews[after][0]) if after.any() else None,
                  "reviews_from": int((~after).sum()), "reviews_to": int(after.sum()),
                  "dir_from": dir_a, "dir_to": dir_b}
    else:
        if switch_day is not None:
            raise ValueError("--switch-day needs --switch-from/--switch-to")
        q, _ = review_quantiles(teacher_dir, model, sl, reviews, H)
    return {"meta": sub, "y": y, "price": price, "q": q, "reviews": reviews, "start_day": start_day,
            "VAL_START": val, "TEST_START": test, "T_END": T, "H": H, "store": store, "model": model,
            "switch": switch, "slice": sl}


# --------------------------------------------------------------------------- helpers
def _is_pg(conn) -> bool:
    return conn.dialect.name == "postgresql"


def _bulk_insert(conn, table, rows: List[dict], chunk: int = 50_000) -> None:
    """COPY on PostgreSQL (via db_bulk.psql_insert_copy semantics), executemany elsewhere."""
    if not rows:
        return
    if _is_pg(conn):
        import csv
        from io import StringIO
        keys = list(rows[0].keys())
        raw = conn.connection.driver_connection
        cols = ", ".join(f'"{k}"' for k in keys)
        for k in range(0, len(rows), chunk):
            buf = StringIO()
            w = csv.writer(buf)
            for r in rows[k:k + chunk]:
                w.writerow(["" if r[c] is None else (json.dumps(r[c]) if isinstance(r[c], dict) else r[c])
                            for c in keys])
            buf.seek(0)
            with raw.cursor() as cur:
                cur.copy_expert(f'COPY "{table.name}" ({cols}) FROM STDIN WITH (FORMAT CSV)', buf)
    else:
        for k in range(0, len(rows), chunk):
            conn.execute(table.insert(), rows[k:k + chunk])


# --------------------------------------------------------------------------- steps
def load_classes(db, td: Dict[str, object]) -> Dict[str, int]:
    from sqlalchemy import delete
    from app.models.classification import SKUClassification

    store, meta, y, price = td["store"], td["meta"], td["y"], td["price"]
    s0 = int(td["start_day"])
    a, b = max(0, td["VAL_START"] - 364 - s0), td["VAL_START"] - s0  # classification window 1031..1394
    rev = (y[:, a:b] * price[:, a:b]).sum(axis=1)
    mu = y[:, a:b].mean(axis=1)
    sd = y[:, a:b].std(axis=1)
    total = float(rev.sum()) or 1.0
    order = np.argsort(-rev, kind="stable")
    cum = np.empty_like(rev)
    cum[order] = np.cumsum(rev[order]) / total * 100.0
    item_ids = meta["item_id"].astype(str).tolist()
    labels = meta["abcxyz_merged"].astype(str).tolist()
    now = datetime.now(timezone.utc)
    rows = [{
        "id": f"{store}_{iid}", "item_id": iid, "store_id": store, "abc_class": lab[0], "xyz_class": lab[1],
        "segment": lab, "class_source": CLASS_SOURCE_TEACHER, "threshold_segment": None,
        "revenue": round(float(rev[i]), 4), "revenue_share": round(float(rev[i]) / total * 100.0, 6),
        "cumulative_share": round(float(cum[i]), 6), "mean_demand": round(float(mu[i]), 6),
        "std_demand": round(float(sd[i]), 6), "cv": round(float(sd[i] / mu[i]), 6) if mu[i] > 0 else 0.0,
        "updated_at": now,
    } for i, (iid, lab) in enumerate(zip(item_ids, labels))]
    before = {r[0] for r in db.query(SKUClassification.item_id).filter(SKUClassification.store_id == store)}
    # whole-store replace: the store's classification becomes exactly the teacher's (dropped SKUs leave the classes)
    db.execute(delete(SKUClassification).where(SKUClassification.store_id == store))
    _bulk_insert(db.connection(), SKUClassification.__table__, rows)
    db.commit()
    counts: Dict[str, int] = {}
    for lab in labels:
        counts[lab] = counts.get(lab, 0) + 1
    return {"rows": len(rows), "replaced_rows": len(before), "removed_non_teacher": len(before - set(item_ids)),
            **{f"class_{k}": v for k, v in sorted(counts.items())}}


def load_sales(db, td: Dict[str, object]) -> Dict[str, int]:
    from sqlalchemy import text
    from app.models.sales_history import SalesHistory

    store, meta, y = td["store"], td["meta"], td["y"]
    s0 = int(td["start_day"])
    item_ids = meta["item_id"].astype(str).tolist()
    n, D = y.shape
    dates = [day_to_date(s0 + j) for j in range(D)]
    conn = db.connection()
    if _is_pg(conn):
        conn.execute(text("CREATE TEMP TABLE IF NOT EXISTS _p2_sales (id text, item_id text, store_id text, "
                          "sale_date date, quantity double precision) ON COMMIT DROP"))
        conn.execute(text("TRUNCATE _p2_sales"))
        import csv
        from io import StringIO
        raw = conn.connection.driver_connection
        step = max(1, 400_000 // max(D, 1))
        for k in range(0, n, step):
            buf = StringIO()
            w = csv.writer(buf)
            for i in range(k, min(n, k + step)):
                iid = item_ids[i]
                for j, d in enumerate(dates):
                    ds = d.isoformat()
                    w.writerow((f"{iid}_{store}_{ds}", iid, store, ds, float(y[i, j])))
            buf.seek(0)
            with raw.cursor() as cur:
                cur.copy_expert("COPY _p2_sales (id, item_id, store_id, sale_date, quantity) FROM STDIN WITH (FORMAT CSV)",
                                buf)
        res = conn.execute(text(
            "INSERT INTO sales_history (id, item_id, store_id, sale_date, quantity) "
            "SELECT id, item_id, store_id, sale_date, quantity FROM _p2_sales "
            "ON CONFLICT (id, sale_date) DO UPDATE SET quantity = EXCLUDED.quantity, item_id = EXCLUDED.item_id, "
            "store_id = EXCLUDED.store_id WHERE sales_history.quantity IS DISTINCT FROM EXCLUDED.quantity"))
        changed = res.rowcount
    else:
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        rows = [{"id": f"{item_ids[i]}_{store}_{d.isoformat()}", "item_id": item_ids[i], "store_id": store,
                 "sale_date": d, "quantity": float(y[i, j])} for i in range(n) for j, d in enumerate(dates)]
        stmt = sqlite_insert(SalesHistory.__table__)
        stmt = stmt.on_conflict_do_update(index_elements=["id", "sale_date"],
                                          set_={"quantity": stmt.excluded.quantity})
        for k in range(0, len(rows), 20_000):
            conn.execute(stmt, rows[k:k + 20_000])
        changed = len(rows)
    db.commit()
    return {"rows": n * D, "inserted_or_updated": int(changed), "items": n, "days": D,
            "first_date": dates[0].isoformat(), "last_date": dates[-1].isoformat()}


def load_prices(db, td: Dict[str, object]) -> Dict[str, int]:
    from app.models.product import Product

    meta = td["meta"]
    mp = dict(zip(meta["item_id"].astype(str), meta["mean_price"].astype(float)))
    have = {p.item_id: p for p in db.query(Product).filter(Product.item_id.in_(list(mp))).all()}
    updated = created = 0
    for iid, p in mp.items():
        prod = have.get(iid)
        if prod is None:
            r = meta[meta["item_id"] == iid].iloc[0]
            db.add(Product(item_id=iid, name=iid, dept_id=str(r["dept_id"]), cat_id=str(r["cat_id"]),
                           price=round(float(p), 4)))
            created += 1
        elif prod.price is None or float(prod.price) <= 0:
            prod.price = round(float(p), 4)
            updated += 1
    db.commit()
    return {"teacher_items": len(mp), "price_filled": updated, "products_created": created,
            "kept_existing_price": len(mp) - updated - created, "daily_price_table": 0}


def load_quantiles(db, td: Dict[str, object]) -> Dict[str, int]:
    from sqlalchemy import delete
    from app.models.forecast_window_quantile import ForecastWindowQuantile
    from app.services import policy_config as pc
    from app.services.window_quantile_service import DEFAULT_MODEL_RUN_ID

    store, meta, q, reviews, H = td["store"], td["meta"], td["q"], td["reviews"], int(td["H"])
    item_ids = meta["item_id"].astype(str).tolist()
    keys = [str(lv) for lv in QUANTILE_LEVELS]
    i50 = QUANTILE_LEVELS.index(0.5)
    now = datetime.now(timezone.utc)
    origin_dates = [day_to_date(int(r)) for r in reviews]
    # replace every row of these (store, origins, H, model run): computed route-(c) rows included
    for k in range(0, len(origin_dates), 20):
        db.execute(delete(ForecastWindowQuantile).where(
            ForecastWindowQuantile.store_id == store,
            ForecastWindowQuantile.model_run_id == DEFAULT_MODEL_RUN_ID,
            ForecastWindowQuantile.horizon_days == H,
            ForecastWindowQuantile.origin_date.in_(origin_dates[k:k + 20])))
    sw = td.get("switch")
    rows = []
    for k, od in enumerate(origin_dates):
        qk = np.round(q[k], 4)
        src_model = (sw["to"] if int(reviews[k]) >= int(sw["day"]) else sw["from"]) if sw else td.get("model")
        for i, iid in enumerate(item_ids):
            rows.append({
                "id": f"{DEFAULT_MODEL_RUN_ID}_{store}_{iid}_{od}_{H}", "model_run_id": DEFAULT_MODEL_RUN_ID,
                "store_id": store, "item_id": iid, "origin_date": od, "horizon_days": H,
                "point_window": float(qk[i, i50]),
                "q_levels": {kk: float(v) for kk, v in zip(keys, qk[i])},
                "route": pc.ROUTE_TEACHER, "source_model": src_model, "created_at": now,
            })
    _bulk_insert(db.connection(), ForecastWindowQuantile.__table__, rows)
    db.commit()
    out = {"rows": len(rows), "origins": len(origin_dates), "items": len(item_ids), "horizon_days": H,
           "first_origin": origin_dates[0].isoformat(), "last_origin": origin_dates[-1].isoformat(),
           "model": td.get("model")}
    if td.get("switch"):
        out["switch"] = td["switch"]
    return out


def load_sources(db, td: Dict[str, object], teacher_dir: str, models: Sequence[str]) -> Dict[str, object]:
    """Each model's (L+R)-window quantiles at the review origins into window_quantile_source (replace per model)."""
    from sqlalchemy import delete
    from app.models.window_quantile_source import WindowQuantileSource

    store, meta, reviews, H, sl = td["store"], td["meta"], td["reviews"], int(td["H"]), td["slice"]
    item_ids = meta["item_id"].astype(str).tolist()
    keys = [str(lv) for lv in QUANTILE_LEVELS]
    i50 = QUANTILE_LEVELS.index(0.5)
    origin_dates = [day_to_date(int(r)) for r in reviews]
    out: Dict[str, object] = {}
    for model in models:
        q, fdir = review_quantiles(teacher_dir, model, sl, reviews, H)
        db.execute(delete(WindowQuantileSource).where(WindowQuantileSource.store_id == store,
                                                      WindowQuantileSource.model == model,
                                                      WindowQuantileSource.horizon_days == H))
        n = 0
        for k0 in range(0, len(origin_dates), 13):   # ~38k rows per batch: bounded memory
            rows = []
            for k in range(k0, min(len(origin_dates), k0 + 13)):
                od, qk = origin_dates[k], np.round(q[k], 4)
                for i, iid in enumerate(item_ids):
                    rows.append({"id": f"{model}_{store}_{iid}_{od}_{H}", "store_id": store, "model": model,
                                 "item_id": iid, "origin_date": od, "horizon_days": H,
                                 "point_window": float(qk[i, i50]),
                                 "q_levels": {kk: float(v) for kk, v in zip(keys, qk[i])}, "source_dir": fdir})
            _bulk_insert(db.connection(), WindowQuantileSource.__table__, rows)
            n += len(rows)
        db.commit()
        out[model] = {"rows": n, "origins": len(origin_dates), "dir": fdir}
    return out


def _q_levels_json(row: np.ndarray, keys: Sequence[str]) -> str:
    return "{" + ", ".join(f'"{k}": {float(v)!r}' for k, v in zip(keys, row)) + "}"


def load_daily_quantiles(db, td: Dict[str, object], teacher_dir: str, horizons: Sequence[int],
                         first_day: Optional[int] = None, last_day: Optional[int] = None,
                         chunk_origins: int = 20) -> Dict[str, object]:
    """``--daily-origins``: Q_H window quantiles (19 levels) of ``td['model']`` at EVERY day t in
    [first_day, last_day] (default VAL_START .. T_END - 1) for each H in ``horizons`` (H = L + R: 4 for R = 1,
    10 for R = 7), same model_run_id / route = 'teacher' / row shape as the weekly rows.

    Idempotent: an origin that already carries a teacher row for every SKU of the store at that H (e.g. the weekly
    H = 10 rows of the ``quantiles`` step) is KEPT as it is (never duplicated, a model-switch run is not
    overwritten); every other origin of the range is replaced (its rows of that H and model run deleted, computed
    route-(c) rows included, like ``load_quantiles``) and re-inserted with COPY on PostgreSQL."""
    from sqlalchemy import delete, func
    from app.models.forecast_window_quantile import ForecastWindowQuantile as FWQ
    from app.services import policy_config as pc
    from app.services.window_quantile_service import DEFAULT_MODEL_RUN_ID

    if td.get("switch"):
        raise ValueError("--daily-origins does not support a model switch")
    store, meta, model = td["store"], td["meta"], str(td["model"])
    lo = int(td["VAL_START"] if first_day is None else first_day)
    hi = int(int(td["T_END"]) - 1 if last_day is None else last_day)
    days = np.arange(lo, hi + 1)
    item_ids = meta["item_id"].astype(str).tolist()
    n = len(item_ids)
    sl = td["slice"]
    keys = [str(lv) for lv in QUANTILE_LEVELS]
    i50 = QUANTILE_LEVELS.index(0.5)
    now = datetime.now(timezone.utc)
    out: Dict[str, object] = {"model": model, "first_origin": day_to_date(lo).isoformat(),
                              "last_origin": day_to_date(hi).isoformat(), "items": n}
    for H in [int(h) for h in horizons]:
        t0 = time.time()
        fdir = resolve_forecast_dir(teacher_dir, model, days, H)
        origins = np.load(os.path.join(fdir, "origins.npy"))
        qa = np.load(os.path.join(fdir, f"Q_H{H}.npy"), mmap_mode="r")
        if qa.ndim != 3 or qa.shape[2] != len(QUANTILE_LEVELS) or qa.shape[0] != len(origins):
            raise ValueError(f"unexpected {fdir}/Q_H{H} shape {qa.shape}")
        oidx = np.searchsorted(origins, days)
        # origins already complete for this H (teacher route, every SKU) are kept
        have = {od: c for od, c in db.query(FWQ.origin_date, func.count(FWQ.id)).filter(
            FWQ.store_id == store, FWQ.model_run_id == DEFAULT_MODEL_RUN_ID, FWQ.horizon_days == H,
            FWQ.route == pc.ROUTE_TEACHER, FWQ.origin_date >= day_to_date(lo), FWQ.origin_date <= day_to_date(hi),
        ).group_by(FWQ.origin_date).all()}
        todo = [int(d) for d in days if have.get(day_to_date(int(d)), 0) < n]
        kept = len(days) - len(todo)
        inserted = deleted = 0
        conn = db.connection()
        for k in range(0, len(todo), chunk_origins):
            part = todo[k:k + chunk_origins]
            dates = [day_to_date(d) for d in part]
            deleted += db.execute(delete(FWQ).where(
                FWQ.store_id == store, FWQ.model_run_id == DEFAULT_MODEL_RUN_ID, FWQ.horizon_days == H,
                FWQ.origin_date.in_(dates))).rowcount or 0
            rows = []
            for d, od in zip(part, dates):
                qk = np.round(np.asarray(qa[int(oidx[d - lo]), sl, :], dtype=np.float64), 4)
                if qk.shape[0] != n:
                    raise ValueError(f"Q_H{H} origin {d}: {qk.shape[0]} rows, expected {n}")
                ods = od.isoformat()
                for i, iid in enumerate(item_ids):
                    rows.append({
                        "id": f"{DEFAULT_MODEL_RUN_ID}_{store}_{iid}_{ods}_{H}", "model_run_id": DEFAULT_MODEL_RUN_ID,
                        "store_id": store, "item_id": iid, "origin_date": od, "horizon_days": H,
                        "point_window": float(qk[i, i50]),
                        "q_levels": (_q_levels_json(qk[i], keys) if _is_pg(conn)
                                     else {kk: float(v) for kk, v in zip(keys, qk[i])}),
                        "route": pc.ROUTE_TEACHER, "created_at": now,
                    })
            _bulk_insert(conn, FWQ.__table__, rows)
            inserted += len(rows)
            db.commit()
            conn = db.connection()
        out[f"H{H}"] = {"origins": len(days), "origins_kept_existing": kept, "origins_loaded": len(todo),
                        "rows_inserted": inserted, "rows_deleted": int(deleted), "folder": fdir,
                        "seconds": round(time.time() - t0, 1)}
    return out


def set_clock(db, td: Dict[str, object], initial_refit: bool = True, start_day: Optional[int] = None,
              refit_as_of_day: Optional[int] = None) -> Dict[str, object]:
    """Clock at ``start_day`` (default TEST_START), clean simulation state of the store, theta_0 = 0, initial stock,
    J5 selection #0.

    Continuous start (teacher E10b simulates from VAL_START = 1395): ``start_day = 1395``. J5 has no review before
    1395 to score, so ``refit_as_of_day`` (e.g. TEST_START) computes selection #0 as of that day instead (window of the
    26 weeks before it, i.e. the teacher's validation choice that it also applies from VAL_START); the clock is put
    back at ``start_day`` afterwards."""
    from sqlalchemy import delete, or_
    from app.models.calibration_state import CalibrationState
    from app.models.inventory_daily import InventoryDaily
    from app.models.policy_selection import PolicySelection
    from app.models.replenishment import ReplenishmentRecommendation
    from app.models.service_outcomes import ServiceOutcome
    from app.models.sim_clock import SimClock
    from app.models.sim_state import SimShadowDaily, SimSnapshot
    from app.services import policy_config as pc
    from app.services.simulator_service import SIM_ACTOR, ensure_tables, simulator_service

    store = td["store"]
    start = day_to_date(int(td["TEST_START"] if start_day is None else start_day))
    ensure_tables(db)
    out: Dict[str, object] = {"start_date": start.isoformat()}
    out["deleted_snapshot"] = db.execute(delete(SimSnapshot).where(SimSnapshot.store_id == store)).rowcount
    out["deleted_shadow"] = db.execute(delete(SimShadowDaily).where(SimShadowDaily.store_id == store)).rowcount
    out["deleted_outcomes"] = db.execute(delete(ServiceOutcome).where(ServiceOutcome.store_id == store)).rowcount
    out["deleted_inventory_daily"] = db.execute(delete(InventoryDaily).where(InventoryDaily.store_id == store)).rowcount
    out["deleted_sim_orders"] = db.execute(delete(ReplenishmentRecommendation).where(
        ReplenishmentRecommendation.store_id == store, ReplenishmentRecommendation.decided_by == SIM_ACTOR)).rowcount
    out["deleted_c3_states"] = db.execute(delete(CalibrationState).where(
        CalibrationState.store_id == store, CalibrationState.review_index >= 1)).rowcount
    out["deleted_store_selections"] = db.execute(delete(PolicySelection).where(or_(
        PolicySelection.selection_id.startswith(f"{store}_quarter_", autoescape=True),
        PolicySelection.selection_id.startswith(f"{store}_refit_", autoescape=True)))).rowcount
    # theta_0 = 0 for the 9 classes at the clock start (teacher THETA_INIT; replaces any artifact warm start)
    db.execute(delete(CalibrationState).where(CalibrationState.store_id == store, CalibrationState.review_index == 0))
    now = datetime.now(timezone.utc)
    for c in pc.ALL_CLASSES:
        db.add(CalibrationState(id=f"{store}_{c}_rev_0", calibrator_id="teacher_sandbox_init", store_id=store,
                                class_id=c, review_index=0, review_date=start, theta=pc.THETA_INIT,
                                multiplier=1.0, error_rate=None, at_boundary=False, setpoint=pc.C3_SETPOINT,
                                eta=pc.CONTROLLER_ETA, created_at=now))
    clock = db.query(SimClock).filter(SimClock.store_id == store).first()
    if clock is None:
        clock = SimClock(store_id=store, current_date=start, start_date=start, mode="replay", speed=1.0)
        db.add(clock)
    clock.start_date = start
    clock.current_date = start
    clock.updated_at = now
    db.commit()
    base = simulator_service.initialise_baseline(db, store)  # round(mean 28 days * (L+R)), snapshot
    out["initial_stock_total"] = base["total_on_hand"]
    out["n_skus_in_products"] = base["n_skus"]
    if initial_refit:
        from app.services.optimization_service import optimization_service
        t0 = time.time()
        if refit_as_of_day is not None and day_to_date(int(refit_as_of_day)) != start:
            clock.current_date = day_to_date(int(refit_as_of_day))
            db.commit()
            out["initial_refit_as_of"] = clock.current_date.isoformat()
        sel = optimization_service.refit_quarterly_policies(db, store_id=store, selection_id=f"{store}_refit_0")
        clock.current_date = start
        db.commit()
        optimization_service.recompute_parameters(db, store_id=store)
        db.commit()
        out["initial_refit_seconds"] = round(time.time() - t0, 1)
        out["initial_selection"] = {r.get("class_id"): [r.get("m_g"), r.get("kappa_g")] for r in sel}
    return out


def run(db, teacher_dir: str, store: str = "CA_1", model: str = "ensemble", start_day: int = 1031,
        steps: Sequence[str] = STEPS, initial_refit: bool = True, log=print, switch_from: Optional[str] = None,
        switch_to: Optional[str] = None, switch_day: Optional[int] = None, clock_start_day: Optional[int] = None,
        refit_as_of_day: Optional[int] = None, daily_horizons: Optional[Sequence[int]] = None,
        source_models: Optional[Sequence[str]] = None) -> Dict[str, object]:
    t0 = time.time()
    td = read_teacher(teacher_dir, store, model, start_day, switch_from=switch_from, switch_to=switch_to,
                      switch_day=switch_day)
    report: Dict[str, object] = {"store": store, "n_skus": int(td["y"].shape[0]),
                                 "read_seconds": round(time.time() - t0, 1)}
    log(f"read teacher arrays: {report['n_skus']} SKUs ({report['read_seconds']}s)")
    fns = {"classes": load_classes, "sales": load_sales, "prices": load_prices, "quantiles": load_quantiles,
           "sources": lambda db_, td_: load_sources(db_, td_, teacher_dir, source_models or ["ensemble"])}
    if daily_horizons:  # --daily-origins: the quantiles step stores daily-origin rows for each H instead
        fns["quantiles"] = lambda db_, td_: load_daily_quantiles(db_, td_, teacher_dir, daily_horizons)
    for step in steps:
        t1 = time.time()
        res = (set_clock(db, td, initial_refit, clock_start_day, refit_as_of_day) if step == "clock"
               else fns[step](db, td))
        res["seconds"] = round(time.time() - t1, 1)
        report[step] = res
        log(f"{step}: {res}")
    report["total_seconds"] = round(time.time() - t0, 1)
    return report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--teacher-dir", default=os.environ.get("TEACHER_DIR", r"C:\DATN\26FA_SET490_Inventory"))
    ap.add_argument("--store", default="CA_1")
    ap.add_argument("--model", default="ensemble")
    ap.add_argument("--start-day", type=int, default=1031)
    ap.add_argument("--steps", nargs="+", default=list(STEPS), choices=STEPS + OPTIONAL_STEPS)
    ap.add_argument("--source-models", nargs="+", default=["ensemble", "chronos_bolt"],
                    help="sources step: models whose window quantiles are kept for the in-app model switch")
    ap.add_argument("--no-initial-refit", action="store_true")
    ap.add_argument("--switch-from", default=None, metavar="MODEL", help="model of the reviews before --switch-day")
    ap.add_argument("--switch-to", default=None, metavar="MODEL", help="model of the reviews from --switch-day on")
    ap.add_argument("--switch-day", type=int, default=None, help="day index of the switch (default TEST_START+182)")
    ap.add_argument("--clock-start-day", type=int, default=None,
                    help="clock step: start day index (default TEST_START 1577; 1395 = continuous from VAL_START)")
    ap.add_argument("--refit-as-of-day", type=int, default=None,
                    help="clock step: compute J5 selection #0 as of this day (e.g. 1577 with --clock-start-day 1395)")
    ap.add_argument("--daily-origins", action="store_true",
                    help="quantiles step: store the window quantiles at EVERY day VAL_START..T_END-1 (needed by the "
                         "what-if with R = 1) for each H of --horizons instead of the weekly reviews")
    ap.add_argument("--horizons", type=int, nargs="+", default=[L_DEFAULT + 1, L_DEFAULT + R_DEFAULT],
                    help="with --daily-origins: window lengths H = L + R to store (default 4 10)")
    ap.add_argument("--report", default=None, help="write the JSON report here")
    args = ap.parse_args(argv)

    url = assert_sandbox_url(os.environ.get("DATABASE_URL"))
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.core.schema_upgrades import apply_schema_upgrades
    from app.models.base import Base
    import app.models  # noqa: F401  (register every table)

    engine = create_engine(url)
    Base.metadata.create_all(bind=engine, checkfirst=True)
    apply_schema_upgrades(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    anchor = pc.load_calendar_setting(db)  # a sandbox shifted by shift_sandbox_calendar.py keeps its calendar
    if anchor != pc.M5_DAY0_DEFAULT:
        print(f"calendar: replay database shifted, d_1 = {anchor}")
    try:
        rep = run(db, args.teacher_dir, args.store, args.model, args.start_day, args.steps,
                  not args.no_initial_refit, switch_from=args.switch_from, switch_to=args.switch_to,
                  switch_day=args.switch_day, clock_start_day=args.clock_start_day,
                  refit_as_of_day=args.refit_as_of_day,
                  daily_horizons=args.horizons if args.daily_origins else None,
                  source_models=args.source_models)
    finally:
        db.close()
    if args.report:
        with open(args.report, "w", encoding="utf-8") as f:
            json.dump(rep, f, indent=1, default=str)
    print(json.dumps({k: v for k, v in rep.items()}, default=str, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
