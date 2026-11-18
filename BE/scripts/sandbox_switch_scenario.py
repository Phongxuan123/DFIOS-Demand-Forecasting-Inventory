"""P3 sandbox: the teacher's model-switch scenario (E6 / E9c, demo.md 'model switch') with the LIVE engine.

The forecast pipeline changes from model A to model B at SWITCH = TEST_START + 182 = day 1759 (2015-11-23): reviews
before it read A's window quantiles, reviews from it on read B's, under the same model_run_id / route = 'teacher'
(``load_teacher_data.py --switch-from A --switch-to B``). Nothing is re-tuned by hand: the only adaptation is the
engine's normal J5 refit every 91 days (1668, 1759, 1850) and, when on, the one-sided C3-OUT offset.

For every scenario (default chronos_bolt->ensemble plus the no-switch controls chronos_bolt and ensemble) and C3 on
and off, the script
  1. loads the scenario's quantiles once and resets the clock (``load_teacher_data.run(steps=quantiles, clock)``:
     2015-05-25, theta_0 = 0, initial stock, J5 selection #0),
  2. drives ``simulator_service.advance`` over the test year (``sandbox_engine_run.drive``),
  3. scores it with ``sandbox_engine_run.score`` and with per-cycle class availability (inventory_daily), from which
     the teacher's service metrics are computed (c3out/revision.py, re-implemented here):
       rolling_violation = share of (4-cycle window, class) pairs whose availability is > 1 pp below 0.95,
       recovery_days     = first 3 consecutive 4-cycle windows that start on/after the switch day with mean
                           |availability - 0.95| over classes <= 2 pp; days from the switch to the end of the last
                           cycle of the third window; NaN (null) when never recovered.
     Signals: 'stockout' (a cycle day ends with on-hand <= 0, the teacher's E9c guard signal) and 'lost'.
Then (``--replay``) the same scenarios on CA_1 with the offline replay library ``app.services.e10b_replay`` (Q
swapped at the switch day, candidates simulated without C3, C3 from 1395 like E9c, or from 1577 like the engine),
and (``--teacher``) the teacher's 3-store E9c numbers from DFIOS/results/e9/switch_c3/<a>__to__<b>_L3_R7/runs.csv.

Database guard as the loader (sqlite or localhost ``dfios_sandbox*``). Teacher folder read-only.

    python scripts/sandbox_switch_scenario.py --out-dir ../../switch_out                  # engine 6 runs
    python scripts/sandbox_switch_scenario.py --no-engine --replay --teacher --out-dir ../../switch_out
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
import time
from datetime import timedelta

sys.dont_write_bytecode = True
BE_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SCRIPTS = os.path.dirname(os.path.abspath(__file__))
for p in (BE_DIR, SCRIPTS):
    if p not in sys.path:
        sys.path.insert(0, p)

import numpy as np  # noqa: E402

import load_teacher_data as ltd  # noqa: E402

L, R = 3, 7
TARGET, WINDOW, TOLERANCE, SUSTAINED = 0.95, 4, 0.02, 3
SWITCH_DAY = ltd.TEST_START + 182  # 1759 = 2015-11-23
DEFAULT_SCENARIOS = ("chronos_bolt:ensemble", "chronos_bolt:chronos_bolt", "ensemble:ensemble")


# --------------------------------------------------------------------------- teacher service metrics
def service_metrics(errors: np.ndarray, target: float = TARGET, window: int = WINDOW) -> dict:
    """``c3out.revision.service_metrics`` on errors [complete cycle, class] (class means unweighted)."""
    errors = np.asarray(errors, dtype=float)
    csl = 1.0 - errors.mean(0)
    if len(errors) >= window:
        rolling = np.lib.stride_tricks.sliding_window_view(errors, window, axis=0).mean(-1)
        viol = np.maximum(target - (1.0 - rolling), 0.0)
        rv, rw = float(np.mean(viol > 0.01)), float(np.max(viol))
    else:
        rv = rw = float("nan")
    return {"min_class_csl": float(csl.min()), "rolling_violation": rv, "rolling_worst": rw,
            "feasible": bool((csl >= target - 1e-12).all())}


def recovery_days(review_days: np.ndarray, cycle_end: np.ndarray, errors: np.ndarray, event_day: int,
                  tolerance: float = TOLERANCE, window: int = WINDOW, sustained: int = SUSTAINED) -> float:
    """``c3out.revision.recovery`` on complete cycles only; NaN when no recovery is observed."""
    if len(errors) < window + sustained - 1:
        return float("nan")
    e = np.lib.stride_tricks.sliding_window_view(np.asarray(errors, float), window, axis=0).mean(-1)
    good = np.abs(1.0 - e - TARGET).mean(1) <= tolerance
    eligible = review_days[:len(good)] >= event_day
    for j in range(len(good) - sustained + 1):
        if eligible[j] and good[j:j + sustained].all():
            return float(cycle_end[j + window + sustained - 2] + 1 - event_day)
    return float("nan")


def class_errors(Z: np.ndarray, groups: np.ndarray, G: int) -> np.ndarray:
    """(K, n) bool -> (K, G) share of the class's SKUs with an event in the cycle."""
    size = np.bincount(groups, minlength=G).astype(float)
    return (Z.astype(float) @ np.eye(G)[groups]) / size


def switch_metrics(review_days, Zs: dict, groups, G, test_start, t_end, switch_day) -> dict:
    """Teacher test / post_switch metrics + recovery for each signal from per-cycle SKU events."""
    review_days = np.asarray(review_days)
    cyc_end = review_days + L + R - 1
    out = {}
    for sig, Z in Zs.items():
        E = class_errors(Z, groups, G)
        res = {}
        for seg, a, b in (("test", test_start, t_end), ("pre_switch", test_start, switch_day),
                          ("post_switch", switch_day, t_end)):
            # teacher segment_masks: review in [a, b), cycle ends before min(b, T)
            m = (review_days >= a) & (review_days < b) & (cyc_end < min(b, t_end))
            res[seg] = {**service_metrics(E[m]), "n_cycles": int(m.sum())}
        m = (review_days >= test_start) & (cyc_end < t_end)
        res["recovery_days"] = recovery_days(review_days[m], cyc_end[m], E[m], switch_day)
        res["class_csl_post"] = (1.0 - E[(review_days >= switch_day) & (cyc_end < t_end)].mean(0)).round(4).tolist()
        out[sig] = res
    return out


# --------------------------------------------------------------------------- engine
def engine_cycle_events(db, store: str, start, end_excl):
    """Per-cycle SKU stock-out / lost events of the engine run, reviews every R days from ``start``."""
    from sqlalchemy import select
    from app.models.classification import SKUClassification
    from app.models.inventory_daily import InventoryDaily

    cls = dict(db.execute(select(SKUClassification.item_id, SKUClassification.segment)
                          .where(SKUClassification.store_id == store)).all())
    items = sorted(cls)
    pos = {i: k for k, i in enumerate(items)}
    T = (end_excl - start).days
    oh = np.full((len(items), T), np.nan)
    lost = np.zeros((len(items), T))
    for iid, d, o, ls in db.execute(select(InventoryDaily.item_id, InventoryDaily.date, InventoryDaily.on_hand_end,
                                           InventoryDaily.lost_sales)
                                    .where(InventoryDaily.store_id == store, InventoryDaily.date >= start,
                                           InventoryDaily.date < end_excl)):
        k = pos.get(iid)
        if k is not None:
            j = (d - start).days
            oh[k, j], lost[k, j] = float(o or 0), float(ls or 0)
    missing = int(np.isnan(oh).all(axis=0).sum())
    oh = np.nan_to_num(oh, nan=0.0)
    s0 = (start - ltd.DAY0).days
    rd, zs, zl = [], [], []
    for k in range(0, T, R):
        c0, c1 = k + L, k + L + R
        if c1 > T:
            break
        rd.append(s0 + k)
        zs.append((oh[:, c0:c1] <= 0).any(axis=1))
        zl.append((lost[:, c0:c1] > 0).any(axis=1))
    names = sorted(set(cls.values()))
    groups = np.array([names.index(cls[i]) for i in items])
    return np.array(rd), {"stockout": np.array(zs), "lost": np.array(zl)}, groups, names, missing


def run_engine(db, teacher_dir: str, store: str, a: str, b: str, c3: bool, switch_day: int, until,
               load_quantiles: bool, log=print) -> dict:
    import sandbox_engine_run as ser
    from app.services.calibrator_service import calibrator_service

    steps = ("quantiles", "clock") if load_quantiles else ("clock",)
    kw = {"switch_from": a, "switch_to": b, "switch_day": switch_day} if a != b else {"model": a}
    t0 = time.time()
    lrep = ltd.run(db, teacher_dir, store, steps=steps, log=lambda *_: None, **kw)
    out = {"scenario": f"{a}->{b}", "source": a, "target": b, "switched": a != b, "c3": c3,
           "switch_day": switch_day, "loader": {k: lrep.get(k) for k in ("quantiles", "clock") if k in lrep},
           "load_seconds": round(time.time() - t0, 1)}
    orig = calibrator_service.run_calibration_step
    if not c3:
        calibrator_service.run_calibration_step = lambda *x, **k: ([], [], 0)  # type: ignore[assignment]
    try:
        t1 = time.time()
        out["advances"] = ser.drive(db, store, until, log=log)
        out["engine_seconds"] = round(time.time() - t1, 1)
    finally:
        calibrator_service.run_calibration_step = orig  # type: ignore[assignment]
    start = ltd.day_to_date(ltd.TEST_START)
    end_excl = until + timedelta(days=1)
    sc = ser.score(db, store, teacher_dir, start, end_excl)
    out["score"] = {k: sc[k] for k in ("daily_teacher_price", "constant_price", "orders", "fill", "min_class_csl",
                                       "class_csl", "n_cycles", "missing_days", "theta_last", "theta_max",
                                       "selections")}
    rd, Zs, groups, names, missing = engine_cycle_events(db, store, start, end_excl)
    out["classes"] = names
    out["metrics"] = switch_metrics(rd, Zs, groups, len(names), ltd.TEST_START, (end_excl - ltd.DAY0).days,
                                    switch_day)
    out["theta_path"] = theta_path(db, store)
    return out


def theta_path(db, store: str) -> dict:
    from app.models.calibration_state import CalibrationState
    path: dict = {}
    for st in db.query(CalibrationState).filter(CalibrationState.store_id == store).order_by(
            CalibrationState.review_index):
        path.setdefault(st.class_id, []).append(round(float(st.theta or 0.0), 4))
    return path


# --------------------------------------------------------------------------- offline replay (e10b_replay)
def simulate_events(inputs, cfg, mult, kappa, base, c3_from=None):
    """``e10b_replay.simulate`` plus the lost-sales event matrix; C3 only updates from review day ``c3_from``."""
    from app.services.e10b_replay import c3_update, initial_stock
    V, T = cfg.VAL_START, cfg.T
    rd = inputs.review_days
    K, n, G, groups = len(rd), inputs.n, inputs.G, inputs.groups
    D = T - V
    yd, pd_ = inputs.daily(V, T)
    gsize = inputs.class_sizes
    oh = initial_stock(inputs.y, cfg)
    pipe = np.zeros((D + L + 1, n))
    theta = np.zeros(G)
    dly = cfg.c3_delay
    hold_t = lost_t = 0.0
    nord_t = 0
    dem_t = lu_t = 0.0
    Zs = np.zeros((K, n), bool)
    Zl = np.zeros((K, n), bool)
    thetas = np.zeros((K, G))
    for rel in range(D):
        oh += pipe[rel]
        if rel % R == 0:
            k = rel // R
            if c3_from is not None and k - dly >= 0 and rd[k] >= c3_from:
                e = np.bincount(groups, weights=Zs[k - dly].astype(float), minlength=G) / gsize
                theta = c3_update(theta, e, cfg)
            thetas[k] = theta
            s = np.ceil(inputs.q[k] * np.exp((mult[k] + theta)[groups]) - 1e-9)
            batch = np.ceil(kappa[k][groups] * base[k] - 1e-9)
            ip = oh + pipe[rel + 1:rel + L].sum(0)
            qty = np.maximum(np.where(ip < s, s + batch - ip, 0.0), 0.0)
            if V + rel >= cfg.TEST_START:
                nord_t += int((qty > 0).sum())
            pipe[rel + L] += qty
        dem = yd[rel]
        sales = np.minimum(oh, dem)
        lost = dem - sales
        oh -= sales
        if V + rel >= cfg.TEST_START:
            p = pd_[rel]
            hold_t += float((oh * p).sum())
            lost_t += float((lost * p).sum())
            dem_t += float(dem.sum())
            lu_t += float(lost.sum())
        if rel >= L:
            kc = (rel - L) // R
            if kc < K:
                Zs[kc] |= oh <= 0
                Zl[kc] |= lost > 0
    cost = {"holding": cfg.h * hold_t, "lost": cfg.b * lost_t, "ordering": cfg.c * nord_t}
    cost["cost"] = sum(cost.values())
    return {"Zs": Zs, "Zl": Zl, "theta": thetas, "cost": cost, "orders": nord_t,
            "fill": 1.0 - lu_t / dem_t if dem_t else float("nan")}


def run_replay(teacher_dir: str, stores, a: str, b: str, switch_day: int, log=print) -> list:
    from app.services import e10b_replay as er
    cfg = er.ReplayConfig(L=L, R=R)
    ia = er.load_teacher_inputs(teacher_dir, a, list(stores), cfg)
    q = ia.q
    if a != b:
        ib = er.load_teacher_inputs(teacher_dir, b, list(stores), cfg)
        q = np.where((ia.review_days >= switch_day)[:, None], ib.q, ia.q)
    inputs = er.ReplayInputs(y=ia.y, price=ia.price, groups=ia.groups, class_names=ia.class_names, q=q,
                             review_days=ia.review_days, L=L, R=R, store_id=ia.store_id, item_id=ia.item_id,
                             model=f"{a}->{b}")
    rows = []
    for rule_policy, label in (("REFIT-RSS-G", "E9c batch k*mu_R"), ("REFIT-RSS-EOQ-G", "E10b batch EOQ")):
        t0 = time.time()
        base = er.batch_base_for(inputs, cfg, rule_policy)
        stats = er.evaluate_candidates(inputs, cfg, rule_policy, base)
        chosen = er.select_per_window(stats, cfg)
        mult, kap, sched = er.build_schedule(chosen, inputs, cfg, refit=True)
        for c3_name, c3_from in (("off", None), ("on_from_1395", cfg.VAL_START), ("on_from_1577", cfg.TEST_START)):
            sim = simulate_events(inputs, cfg, mult, kap, base, c3_from)
            met = switch_metrics(inputs.review_days, {"stockout": sim["Zs"], "lost": sim["Zl"]}, inputs.groups,
                                 inputs.G, cfg.TEST_START, cfg.T, switch_day)
            rows.append({"scenario": f"{a}->{b}", "stores": list(stores), "batch": label, "policy": rule_policy, "c3": c3_name,
                         **sim["cost"], "orders": sim["orders"], "fill": sim["fill"], "metrics": met,
                         "theta_last": dict(zip(inputs.class_names, sim["theta"][-1].round(4).tolist())),
                         "theta_max": dict(zip(inputs.class_names, sim["theta"].max(0).round(4).tolist()))})
        log(f"replay {a}->{b} {rule_policy}: {time.time() - t0:.0f}s")
    return rows


# --------------------------------------------------------------------------- teacher E9c numbers (3 stores)
def teacher_rows(teacher_dir: str, a: str, b: str) -> list:
    path = os.path.join(teacher_dir, "DFIOS", "results", "e9", "switch_c3", f"{a}__to__{b}_L{L}_R{R}", "runs.csv")
    if not os.path.isfile(path):
        return []
    out = []
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["policy"] in ("REFIT-RSS-G", "REFIT-RSS-C3") and r["segment"] in ("test", "post_switch"):
                out.append({k: r[k] for k in ("policy", "segment", "metric_signal", "cost", "fill", "min_class_csl",
                                              "rolling_violation", "rolling_worst", "recovery_days", "n_orders")})
    return out


# --------------------------------------------------------------------------- main
def _nan_none(x):
    if isinstance(x, float) and math.isnan(x):
        return None
    if isinstance(x, dict):
        return {k: _nan_none(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_nan_none(v) for v in x]
    return x


def _dump(path: str, obj) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(_nan_none(obj), f, indent=1, default=str)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--store", default="CA_1")
    ap.add_argument("--teacher-dir", default=os.environ.get("TEACHER_DIR", r"C:\DATN\26FA_SET490_Inventory"))
    ap.add_argument("--scenarios", nargs="+", default=list(DEFAULT_SCENARIOS), help="A:B pairs (A == B: control)")
    ap.add_argument("--switch-day", type=int, default=SWITCH_DAY)
    ap.add_argument("--c3", choices=("both", "on", "off"), default="both")
    ap.add_argument("--until", default=ltd.day_to_date(ltd.T_END - 1).isoformat())
    ap.add_argument("--no-engine", action="store_true")
    ap.add_argument("--replay", action="store_true", help="also run the offline CA_1 replay (no DB)")
    ap.add_argument("--replay-stores", nargs="+", default=None, help="stores of the replay (default --store)")
    ap.add_argument("--replay-out", default="replay_ca1.json")
    ap.add_argument("--teacher", action="store_true", help="also read the teacher's 3-store E9c runs.csv")
    ap.add_argument("--out-dir", required=True)
    args = ap.parse_args(argv)
    os.makedirs(args.out_dir, exist_ok=True)
    pairs = [tuple(s.split(":")) for s in args.scenarios]
    c3s = {"both": (True, False), "on": (True,), "off": (False,)}[args.c3]

    if not args.no_engine:
        from datetime import date
        url = ltd.assert_sandbox_url(os.environ.get("DATABASE_URL"))
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        engine = create_engine(url)
        db = sessionmaker(bind=engine, autoflush=False)()
        try:
            for a, b in pairs:
                for i, c3 in enumerate(c3s):
                    tag = f"engine_{a}__to__{b}_c3{'on' if c3 else 'off'}"
                    print(f"== {tag}", flush=True)
                    rep = run_engine(db, args.teacher_dir, args.store, a, b, c3, args.switch_day,
                                     date.fromisoformat(args.until), load_quantiles=(i == 0),
                                     log=lambda r: print(r, flush=True))
                    _dump(os.path.join(args.out_dir, tag + ".json"), rep)
                    m = rep["metrics"]["stockout"]
                    print(json.dumps(_nan_none({"cost": rep["score"]["daily_teacher_price"]["cost"],
                                                "fill": rep["score"]["fill"],
                                                "rv_test": m["test"]["rolling_violation"],
                                                "rv_post": m["post_switch"]["rolling_violation"],
                                                "recovery": m["recovery_days"]})), flush=True)
        finally:
            db.close()
    if args.replay:
        rows = []
        for a, b in pairs:
            rows += run_replay(args.teacher_dir, args.replay_stores or [args.store], a, b, args.switch_day)
        _dump(os.path.join(args.out_dir, args.replay_out), rows)
    if args.teacher:
        _dump(os.path.join(args.out_dir, "teacher_e9c_3store.json"),
              {f"{a}->{b}": teacher_rows(args.teacher_dir, a, b) for a, b in pairs})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
