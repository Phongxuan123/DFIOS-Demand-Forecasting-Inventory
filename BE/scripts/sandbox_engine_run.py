"""P2 sandbox: drive the LIVE engine (simulator J1-J6: J3 quantiles, C3-OUT, J5 refit every 91 days) over the teacher's
test year for one store and score it like the teacher's replay (test segment, complete cycles only).

Prerequisite: scripts/load_teacher_data.py has loaded the store (clock at 2015-05-25, teacher quantiles, classes).
Same database guard as the loader (local ``dfios_sandbox`` or sqlite only).

    python scripts/sandbox_engine_run.py --store CA_1 --out engine.json            # deployed policy (C3-OUT on)
    python scripts/sandbox_engine_run.py --store CA_1 --no-c3 --out engine_noc3.json   # ablation: theta frozen at 0
    python scripts/sandbox_engine_run.py --score-only --out engine.json            # re-score what is in the DB

Scoring (teacher ``segment_summary``): holding 0.002 * end-of-day on-hand * price, lost 0.35 * lost units * price,
ordering 2 per order line; fill = 1 - lost / demand; class CSL over the cycles [t_k + L, t_k + L + R - 1] of the
reviews t_k in [TEST_START, T_END) that end before T_END, failure = a day ending with on-hand <= 0. Costs are given
with the app's constant ``products.price`` AND re-priced with the teacher's daily ``price.npy``.
Only the teacher's SKUs (the store's classification rows) are scored.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import date, timedelta

sys.dont_write_bytecode = True
BE_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SCRIPTS = os.path.dirname(os.path.abspath(__file__))
for p in (BE_DIR, SCRIPTS):
    if p not in sys.path:
        sys.path.insert(0, p)

import numpy as np  # noqa: E402

from load_teacher_data import DAY0, TEST_START, T_END, assert_sandbox_url, day_to_date  # noqa: E402

L, R = 3, 7


def drive(db, store: str, until: date, chunk_days: int = 84, log=print) -> list:
    from app.models.sim_clock import SimClock
    from app.services.simulator_service import simulator_service

    out = []
    while True:
        clock = db.query(SimClock).filter(SimClock.store_id == store).first()
        db.expire_all()
        if clock.current_date >= until:
            break
        target = min(until, clock.current_date + timedelta(days=chunk_days))
        t0 = time.time()
        res = simulator_service.advance(db, store_id=store, until=target)
        ev = [e for e in res["job_events"] if "J5" in e]
        out.append({"from": str(res["previous_date"]), "to": str(res["current_date"]),
                    "reviews": res["reviews_executed"], "orders": res["recommendations_generated"],
                    "seconds": round(time.time() - t0, 1), "j5": ev})
        log(out[-1])
    return out


def score(db, store: str, teacher_dir: str, start: date, end_excl: date) -> dict:
    """Teacher-style test metrics of the engine run (only the store's classified SKUs)."""
    import pandas as pd
    from sqlalchemy import select
    from app.models.classification import SKUClassification
    from app.models.inventory_daily import InventoryDaily
    from app.models.policy_selection import PolicySelection
    from app.models.product import Product
    from app.models.replenishment import ReplenishmentRecommendation
    from app.models.calibration_state import CalibrationState

    cls = dict(db.execute(select(SKUClassification.item_id, SKUClassification.segment)
                          .where(SKUClassification.store_id == store)).all())
    items = sorted(cls)
    pos = {i: k for k, i in enumerate(items)}
    n = len(items)
    days = [start + timedelta(days=j) for j in range((end_excl - start).days)]
    didx = {d: j for j, d in enumerate(days)}
    T = len(days)
    oh = np.full((n, T), np.nan)
    sales = np.zeros((n, T))
    lost = np.zeros((n, T))
    q = db.execute(select(InventoryDaily.item_id, InventoryDaily.date, InventoryDaily.on_hand_end,
                          InventoryDaily.sales, InventoryDaily.lost_sales)
                   .where(InventoryDaily.store_id == store, InventoryDaily.date >= start,
                          InventoryDaily.date < end_excl))
    for iid, d, o, s, ls in q:
        k = pos.get(iid)
        if k is not None:
            j = didx[d]
            oh[k, j], sales[k, j], lost[k, j] = float(o or 0), float(s or 0), float(ls or 0)
    missing_days = int(np.isnan(oh).all(axis=0).sum())
    oh_f = np.nan_to_num(oh, nan=0.0)
    orders_rows = db.execute(select(ReplenishmentRecommendation.item_id, ReplenishmentRecommendation.review_date,
                                    ReplenishmentRecommendation.final_qty)
                             .where(ReplenishmentRecommendation.store_id == store,
                                    ReplenishmentRecommendation.decided_by == "simulator",
                                    ReplenishmentRecommendation.review_date >= start,
                                    ReplenishmentRecommendation.review_date < end_excl)).all()
    n_orders = sum(1 for iid, _d, qty in orders_rows if iid in pos and float(qty or 0) > 0)
    units_ordered = sum(float(qty or 0) for iid, _d, qty in orders_rows if iid in pos)

    const_price = np.array([float(p) for p in (dict(db.execute(select(Product.item_id, Product.price)).all())
                                               .get(i, 1.0) for i in items)])
    # teacher daily price (read-only mmap), rows ordered like meta
    prep = os.path.join(teacher_dir, "c3out_experiments", "data", "m5_prepared")
    meta = pd.read_parquet(os.path.join(prep, "meta.parquet"), columns=["item_id", "store_id"])
    rows = np.flatnonzero(meta.store_id.values == store)
    mrow = {iid: int(r) for iid, r in zip(meta.item_id.values[rows], rows)}
    a, b = (start - DAY0).days, (end_excl - DAY0).days
    pmm = np.load(os.path.join(prep, "price.npy"), mmap_mode="r")
    daily_price = np.stack([np.asarray(pmm[mrow[i], a:b], dtype=np.float64) for i in items])

    def costs(price2d):
        hold = 0.002 * float((oh_f * price2d).sum())
        lst = 0.35 * float((lost * price2d).sum())
        return {"cost": hold + lst + 2.0 * n_orders, "holding": hold, "lost": lst, "ordering": 2.0 * n_orders}

    demand = sales + lost
    fill = 1.0 - lost.sum() / demand.sum() if demand.sum() > 0 else 1.0
    # cycles of the reviews in [start, end): days t_k + L .. t_k + L + R - 1, complete ones only
    seg = np.array(sorted({cls[i] for i in items}))
    gid = np.array([int(np.searchsorted(seg, cls[i])) for i in items])
    fails, ncyc = [], 0
    for k in range(0, T, R):
        c0, c1 = k + L, k + L + R
        if c1 > T:
            break
        z = (oh_f[:, c0:c1] <= 0).any(axis=1)
        fails.append(z)
        ncyc += 1
    Z = np.array(fails)  # (cycles, n)
    class_csl = {str(g): float(1.0 - Z[:, gid == j].mean()) for j, g in enumerate(seg)}
    sel = [{"selection_id": s.selection_id, "class": s.class_id, "m": s.m_g, "kappa": s.kappa_g,
            "feasible": s.is_feasible, "val_service": s.val_service}
           for s in db.query(PolicySelection).filter(PolicySelection.selection_id.startswith(f"{store}_refit_"))
           .order_by(PolicySelection.selection_id, PolicySelection.class_id)]
    theta = {}
    for st in db.query(CalibrationState).filter(CalibrationState.store_id == store).order_by(
            CalibrationState.review_index):
        theta.setdefault(st.class_id, []).append(round(float(st.theta or 0.0), 4))
    return {
        "segment": [start.isoformat(), (end_excl - timedelta(days=1)).isoformat()], "n_skus": n,
        "missing_days": missing_days, "constant_price": costs(const_price[:, None]),
        "daily_teacher_price": costs(daily_price), "orders": n_orders, "units_ordered": units_ordered,
        "demand_units": float(demand.sum()), "lost_units": float(lost.sum()), "fill": float(fill),
        "n_cycles": ncyc, "class_csl": class_csl, "min_class_csl": min(class_csl.values()),
        "selections": sel, "theta_last": {c: v[-1] for c, v in theta.items()},
        "theta_max": {c: max(v) for c, v in theta.items()},
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--store", default="CA_1")
    ap.add_argument("--teacher-dir", default=os.environ.get("TEACHER_DIR", r"C:\DATN\26FA_SET490_Inventory"))
    ap.add_argument("--until", default=day_to_date(T_END - 1).isoformat())
    ap.add_argument("--no-c3", action="store_true", help="ablation: C3-OUT step disabled (theta stays 0)")
    ap.add_argument("--score-only", action="store_true")
    ap.add_argument("--out", default=None)
    args = ap.parse_args(argv)

    url = assert_sandbox_url(os.environ.get("DATABASE_URL"))
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    engine = create_engine(url)
    db = sessionmaker(bind=engine, autoflush=False)()
    rep = {"store": args.store, "c3": not args.no_c3}
    try:
        if args.no_c3:
            from app.services.calibrator_service import calibrator_service
            calibrator_service.run_calibration_step = lambda *a, **k: ([], [], 0)  # type: ignore[assignment]
        t0 = time.time()
        if not args.score_only:
            rep["advances"] = drive(db, args.store, date.fromisoformat(args.until))
        rep["engine_seconds"] = round(time.time() - t0, 1)
        start = day_to_date(TEST_START)
        rep["score"] = score(db, args.store, args.teacher_dir, start, date.fromisoformat(args.until) + timedelta(days=1))
    finally:
        db.close()
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(rep, f, indent=1, default=str)
    s = rep["score"]
    print(json.dumps({k: s[k] for k in ("constant_price", "daily_teacher_price", "orders", "fill", "min_class_csl",
                                        "class_csl", "n_cycles", "missing_days", "theta_last")}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
