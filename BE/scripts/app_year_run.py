"""Drive the app's engine over the whole test year on a sandbox copy and score it (research_v2 §9.10, H3).

The deployed engine (simulator J1-J6 with J5 every 91 days, C3-OUT, auto-approved orders, the shadow B0 next to it)
is advanced from the store's current clock to ``--until`` in chunks, in-process, then scored from the database the
same way the dashboard does, plus the rolling violation that §9.10 did not have yet.

Start from the day-0 snapshot (stop the backend first; the script refuses any non-sandbox database):

    python scripts/demo_snapshot.py restore demo_start --force
    python scripts/app_year_run.py --out year_c3.json                     # deployed policy (C3-OUT on)
    python scripts/app_year_run.py --no-c3 --out year_noc3.json           # ablation: theta = 0 throughout
    python scripts/app_year_run.py --zero-sales-lot --out year_lot.json   # H9 lot rule on (policy_config flag)
    python scripts/app_year_run.py --quantiles team --out year_team.json  # H1 the team's own route (c) quantiles
    python scripts/app_year_run.py --score-only                           # re-score what is in the database

Scores (store, simulated days [start, current date)):
  * cost = holding (h * price * end-of-day stock) + lost (b * price * lost units) + ordering (c * order lines), the
    DFIOS side (inventory_daily, APPROVED/COMPLETED lines) and the shadow B0 (sim_shadow_daily, its order days);
  * fill rate = sold / (sold + lost);
  * class availability over the closed cycles (service_outcomes; B0 on the same cycle days, a SKU-cycle fails when
    any of its days ends with on-hand <= 0), the lowest class and the classes >= the target;
  * class-cycles whose stockout rate is above 1 - setpoint (0.04), out of 9 x closed cycles;
  * rolling violation (research_v2 §7): share of the windows of 4 consecutive closed cycles of a class whose
    availability is below 0.94, over all classes and windows.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple

sys.dont_write_bytecode = True
BE_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SCRIPTS = os.path.dirname(os.path.abspath(__file__))
for p in (BE_DIR, SCRIPTS):
    if p not in sys.path:
        sys.path.insert(0, p)

from load_teacher_prices import assert_sandbox_prefix_url  # noqa: E402

# the clock date is simulated too (advance until D runs day D), so 363 days after the start = 364 simulated days
YEAR_DAYS = 363
ROLLING_CYCLES = 4
ROLLING_THRESHOLD = 0.94
CYCLE_STOCKOUT_LIMIT = 0.04


def rolling_violation(per_cycle: Dict[str, List[Tuple[int, int, int]]], window: int = ROLLING_CYCLES,
                      threshold: float = ROLLING_THRESHOLD) -> Tuple[int, int]:
    """(violating windows, windows) over the classes; ``per_cycle[class]`` = [(cycle_index, n_sku, n_stockout)]."""
    bad = total = 0
    for rows in per_cycle.values():
        rows = sorted(rows)
        for i in range(len(rows) - window + 1):
            chunk = rows[i:i + window]
            n = sum(r[1] for r in chunk)
            if n <= 0:
                continue
            total += 1
            if 1.0 - sum(r[2] for r in chunk) / n < threshold:
                bad += 1
    return bad, total


def class_cycles(db, store: str, start: date, end: date):
    """DFIOS and B0 per-class, per-cycle (cycle_index, n_sku, n_stockout) over the closed cycles in [start, end]."""
    from app.models.classification import SKUClassification
    from app.models.service_outcomes import ServiceOutcome
    from app.models.sim_state import SimShadowDaily

    so = db.query(ServiceOutcome).filter(ServiceOutcome.store_id == store, ServiceOutcome.cycle_start >= start,
                                         ServiceOutcome.cycle_end <= end).all()
    c3: Dict[str, List[Tuple[int, int, int]]] = {}
    windows: Dict[int, Tuple[date, date]] = {}
    n_of: Dict[Tuple[str, int], int] = {}
    for r in so:
        c3.setdefault(r.class_id, []).append((int(r.cycle_index), int(r.n_sku or 0), int(r.n_stockout or 0)))
        windows[int(r.cycle_index)] = (r.cycle_start, r.cycle_end)
        n_of[(r.class_id, int(r.cycle_index))] = int(r.n_sku or 0)
    seg = {i: s for i, s in db.query(SKUClassification.item_id, SKUClassification.segment)
           .filter(SKUClassification.store_id == store).all()}
    failed = set()
    for item_id, d in db.query(SimShadowDaily.item_id, SimShadowDaily.date).filter(
            SimShadowDaily.store_id == store, SimShadowDaily.date >= start, SimShadowDaily.date <= end,
            SimShadowDaily.on_hand_end <= 0).all():
        g = seg.get(item_id)
        if g is None:
            continue
        for k, (cs, ce) in windows.items():
            if cs <= d <= ce:
                failed.add((g, k, item_id))
    b0_fail: Dict[Tuple[str, int], int] = {}
    for g, k, _ in failed:
        b0_fail[(g, k)] = b0_fail.get((g, k), 0) + 1
    b0 = {g: [(k, n, b0_fail.get((g, k), 0)) for (gg, k), n in n_of.items() if gg == g] for g in c3}
    return c3, b0


def summarise(per_cycle: Dict[str, List[Tuple[int, int, int]]], target: float) -> dict:
    avail = {}
    for g, rows in per_cycle.items():
        n = sum(r[1] for r in rows)
        if n:
            avail[g] = 1.0 - sum(r[2] for r in rows) / n
    cells = [(r[2] / r[1]) for rows in per_cycle.values() for r in rows if r[1]]
    bad_w, n_w = rolling_violation(per_cycle)
    low = min(avail, key=avail.get) if avail else None
    return {
        "class_availability": {g: round(v, 4) for g, v in sorted(avail.items())},
        "lowest_class": low, "lowest_availability": round(avail[low], 4) if low else None,
        "classes_at_target": sum(1 for v in avail.values() if v >= target), "classes": len(avail),
        "class_cycles_over_limit": sum(1 for x in cells if x > CYCLE_STOCKOUT_LIMIT), "class_cycles": len(cells),
        "rolling_violation": round(bad_w / n_w, 4) if n_w else None, "rolling_windows": n_w,
        "rolling_windows_violating": bad_w,
    }


def score(db, store: str) -> dict:
    from sqlalchemy import func

    from app.models.inventory_daily import InventoryDaily
    from app.models.replenishment import ReplenishmentRecommendation
    from app.models.sim_clock import SimClock
    from app.models.sim_state import SimShadowDaily
    from app.services import policy_config as pc
    from app.services.dashboard_service import valued_stock_sums

    pc.sync_costs(db)
    clock = db.query(SimClock).filter(SimClock.store_id == store).first()
    start = db.query(func.min(InventoryDaily.date)).filter(InventoryDaily.store_id == store).scalar()
    end = clock.current_date  # same window as the dashboard (start date .. clock date, inclusive)
    out = {"store": store, "start": str(start), "end": str(end), "days": (end - start).days,
           "costs": {"h": pc.HOLDING_RATE_DAILY, "b": pc.STOCKOUT_PENALTY_RATE, "c": pc.ORDER_COST_C}}
    dfios_orders = db.query(func.count(ReplenishmentRecommendation.id)).filter(
        ReplenishmentRecommendation.store_id == store,
        ReplenishmentRecommendation.status.in_(("APPROVED", "COMPLETED")),
        ReplenishmentRecommendation.review_date >= start,
        ReplenishmentRecommendation.review_date <= end).scalar() or 0
    b0_orders = db.query(func.count()).select_from(SimShadowDaily).filter(
        SimShadowDaily.store_id == store, SimShadowDaily.date >= start, SimShadowDaily.date <= end,
        SimShadowDaily.order_qty > 0).scalar() or 0
    for name, model, orders in (("dfios", InventoryDaily, dfios_orders), ("b0", SimShadowDaily, b0_orders)):
        hv, lv = valued_stock_sums(db, model, [store], start, end, by=None).get(None, (0.0, 0.0))
        sold, lost = db.query(func.sum(model.sales), func.sum(model.lost_sales)).filter(
            model.store_id == store, model.date >= start, model.date <= end).one()
        holding, lost_cost, ordering = hv * pc.HOLDING_RATE_DAILY, lv * pc.STOCKOUT_PENALTY_RATE, orders * pc.ORDER_COST_C
        demand = float(sold or 0) + float(lost or 0)
        out[name] = {"total_cost": round(holding + lost_cost + ordering, 2), "holding": round(holding, 2),
                     "lost": round(lost_cost, 2), "ordering": round(ordering, 2), "orders": int(orders),
                     "fill_rate": round(float(sold or 0) / demand, 4) if demand else None}
    target = pc.TARGET_AVAILABILITY
    c3, b0 = class_cycles(db, store, start, end)
    out["dfios"].update(summarise(c3, target))
    out["b0"].update(summarise(b0, target))
    if out["b0"]["total_cost"]:
        out["dfios_vs_b0_cost"] = round(out["dfios"]["total_cost"] / out["b0"]["total_cost"] - 1.0, 4)
    return out


def drive(db, store: str, until: date, chunk_days: int = 84, log=print) -> None:
    from app.models.sim_clock import SimClock
    from app.services.simulator_service import simulator_service

    while True:
        db.expire_all()
        clock = db.query(SimClock).filter(SimClock.store_id == store).first()
        if clock.current_date >= until:
            return
        frm = clock.current_date
        target = min(until, frm + timedelta(days=chunk_days))
        t = time.time()
        simulator_service.advance(db, store, until=target, approval_mode="auto", expire_pending=True,
                                  triggered_by="app_year_run")
        log(f"  advanced {frm} -> {target} in {time.time() - t:.1f}s")


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--store", default="CA_1")
    ap.add_argument("--until", default=None, help="last simulated day (default: start + 363 days = 364 days)")
    ap.add_argument("--no-c3", action="store_true", help="ablation: theta = 0 for every class, all year")
    ap.add_argument("--zero-sales-lot", action="store_true", help="H9 lot rule on (ZERO_SALES_LOT_FROM_FORECAST)")
    ap.add_argument("--quantiles", choices=("imported", "team"), default=None,
                    help="window quantile source (H1): imported teacher rows (default) or the team's own route (c)")
    ap.add_argument("--score-only", action="store_true")
    ap.add_argument("--out", default=None)
    a = ap.parse_args(argv)

    assert_sandbox_prefix_url(os.environ.get("DATABASE_URL"))
    from app.core.database import SessionLocal
    from app.models.inventory_daily import InventoryDaily
    from app.models.sim_clock import SimClock
    from app.services import policy_config as pc
    from app.services.calibrator_service import calibrator_service

    if a.zero_sales_lot:
        pc.ZERO_SALES_LOT_FROM_FORECAST = True
    if a.quantiles:
        pc.QUANTILE_SOURCE = a.quantiles
    if a.no_c3:
        calibrator_service.get_current_thetas = lambda *_a, **_k: {g: 0.0 for g in pc.ALL_CLASSES}
        calibrator_service.run_calibration_step = lambda *_a, **_k: None

    db = SessionLocal()
    try:
        t0 = time.time()
        if not a.score_only:
            clock = db.query(SimClock).filter(SimClock.store_id == a.store).first()
            first = db.query(InventoryDaily.date).filter(InventoryDaily.store_id == a.store).first()
            if first is not None:
                raise SystemExit("the store has simulated days already: restore the day-0 snapshot first "
                                 "(scripts/demo_snapshot.py restore demo_start --force) or use --score-only")
            until = date.fromisoformat(a.until) if a.until else clock.current_date + timedelta(days=YEAR_DAYS)
            print(f"driving {a.store} {clock.current_date} -> {until} (C3 {'off' if a.no_c3 else 'on'}, "
                  f"zero-sales lot {'on' if pc.ZERO_SALES_LOT_FROM_FORECAST else 'off'}, "
                  f"quantiles {pc.QUANTILE_SOURCE})", flush=True)
            drive(db, a.store, until, log=lambda m: print(m, flush=True))
        res = score(db, a.store)
        res["run"] = {"c3": not a.no_c3, "zero_sales_lot": bool(pc.ZERO_SALES_LOT_FROM_FORECAST),
                      "quantiles": pc.QUANTILE_SOURCE,
                      "seconds": round(time.time() - t0, 1)}
        text = json.dumps(res, indent=2, ensure_ascii=False)
        print(text)
        if a.out:
            with open(a.out, "w", encoding="utf-8") as f:
                f.write(text)
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
