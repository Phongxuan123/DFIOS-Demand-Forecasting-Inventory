"""E7 performance measurement (teacher's open experiment RQ6/E7), against a LOCAL SANDBOX database only.

Guard: DATABASE_URL must be a PostgreSQL database on localhost / 127.0.0.1 whose name starts with ``dfios_sandbox``
(SQLite is refused: the point is to time the real database). DFIOS_LOCAL_ONLY=1 is required. Nothing is started: the
API is called in-process through the FastAPI TestClient (no network listener), so the numbers EXCLUDE HTTP/TCP and
browser time.

  (a) a scratch Admin user is inserted (random password, never printed) and deleted again at the end;
  (b) every dashboard / reports / inventory-screen / forecast-explorer / metrics endpoint is called once cold then
      ``--repeat`` times warm; p50 / p95 / max of the warm calls (and the cold call) are recorded;
  (c) one J4 C3-OUT step and one J5 refit are timed on the store (default CA_1) with the existing service entry
      points; the rows they write (calibration_state, policy_selection) are removed afterwards;
  (d) machine (CPU, RAM), DB size, row counts; linear extrapolation J4 -> 8,831 SKU and J5 -> 3 stores, marked as such.

    DATABASE_URL=postgresql+psycopg2://.../dfios_sandbox_f3 DFIOS_LOCAL_ONLY=1 python scripts/e7_perf.py \
        --out-json e7_perf.json --out-md e7_perf_report.md
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import secrets
import statistics
import sys
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

sys.dont_write_bytecode = True
BE_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
if BE_DIR not in sys.path:
    sys.path.insert(0, BE_DIR)

TARGET_SKUS = 8831       # teacher's J4 target size (all stores' classified SKUs of his experiment)
TARGET_STORES = 3        # teacher's J5 target scope
P95_LIMIT_MS = 2000.0    # dashboard API p95 < 2 s
J4_LIMIT_S = 5.0         # "a few seconds"
J5_LIMIT_S = 300.0       # "a few minutes" (one quarter)


def guard(url: str | None) -> str:
    """Refuse unless the URL is a local PostgreSQL database named dfios_sandbox*."""
    url = (url or "").strip()
    if os.getenv("DFIOS_LOCAL_ONLY", "").strip() not in ("1", "true", "yes"):
        raise SystemExit("refusing: DFIOS_LOCAL_ONLY=1 is required")
    p = urlparse(url.replace("+psycopg2", "").replace("+psycopg", ""))
    if not (p.scheme or "").startswith("postgres"):
        raise SystemExit("refusing: DATABASE_URL must be a PostgreSQL URL")
    if (p.hostname or "").lower() not in ("localhost", "127.0.0.1"):
        raise SystemExit("refusing: host is not localhost/127.0.0.1")
    if not (p.path or "").lstrip("/").startswith("dfios_sandbox"):
        raise SystemExit("refusing: database name does not start with dfios_sandbox")
    return url


def machine_info() -> dict:
    info = {"os": platform.platform(), "python": platform.python_version(), "cpu_count_logical": os.cpu_count(),
            "processor": platform.processor()}
    try:
        import ctypes

        class MS(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("sullAvailExtendedVirtual", ctypes.c_ulonglong)]
        ms = MS()
        ms.dwLength = ctypes.sizeof(MS)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(ms))  # type: ignore[attr-defined]
        info["ram_total_gb"] = round(ms.ullTotalPhys / 2 ** 30, 1)
        info["ram_available_gb_at_start"] = round(ms.ullAvailPhys / 2 ** 30, 1)
    except (AttributeError, OSError):  # not Windows
        try:
            pages, size = os.sysconf("SC_PHYS_PAGES"), os.sysconf("SC_PAGE_SIZE")
            info["ram_total_gb"] = round(pages * size / 2 ** 30, 1)
        except (AttributeError, ValueError, OSError):
            info["ram_total_gb"] = None
    return info


def pct(xs: list, q: float) -> float:
    s = sorted(xs)
    if not s:
        return float("nan")
    k = (len(s) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--store", default="CA_1")
    ap.add_argument("--repeat", type=int, default=20)
    ap.add_argument("--j4-repeats", type=int, default=3)
    ap.add_argument("--skip-j5", action="store_true")
    ap.add_argument("--out-json", default=None)
    ap.add_argument("--out-md", default=None)
    args = ap.parse_args(argv)

    url = guard(os.environ.get("DATABASE_URL"))
    from sqlalchemy import create_engine, func, select, text
    from sqlalchemy.orm import sessionmaker
    from fastapi.testclient import TestClient

    from app.core.security import create_access_token, get_password_hash
    from app.main import app
    from app.models.calibration_state import CalibrationState
    from app.models.classification import SKUClassification
    from app.models.inventory import Inventory
    from app.models.policy_selection import PolicySelection
    from app.models.sim_clock import SimClock
    from app.models.user import User
    from app.services.calibrator_service import calibrator_service
    from app.services.optimization_service import optimization_service

    store = args.store
    engine = create_engine(url)
    # what the app does at startup (lifespan is not run by the TestClient): bring the sandbox schema up to date
    from app.core.schema_upgrades import apply_schema_upgrades
    rep_upgrades = apply_schema_upgrades(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    rep: dict = {"generated_at": datetime.now(timezone.utc).isoformat(), "store": store,
                 "database": urlparse(url.replace("+psycopg2", "")).path.lstrip("/"), "repeat": args.repeat}
    rep["machine"] = machine_info()
    rep["schema_upgrades_applied"] = rep_upgrades

    # ---- database facts
    with engine.connect() as c:
        rep["db_size_bytes"] = int(c.execute(text("select pg_database_size(current_database())")).scalar())
        rep["postgres_version"] = c.execute(text("select version()")).scalar().split(",")[0]
    n_class = db.execute(select(func.count()).select_from(SKUClassification)
                         .where(SKUClassification.store_id == store)).scalar() or 0
    n_inv = db.execute(select(func.count()).select_from(Inventory).where(Inventory.store_id == store)).scalar() or 0
    clock = db.query(SimClock).filter(SimClock.store_id == store).first()
    rep["data"] = {"classified_skus": int(n_class), "inventory_rows": int(n_inv),
                   "sim_clock_start": str(clock.start_date), "sim_clock_current": str(clock.current_date)}
    item_id = db.execute(select(SKUClassification.item_id).where(SKUClassification.store_id == store)
                         .order_by(SKUClassification.item_id).limit(1)).scalar()

    # ---- (a) scratch admin
    password = secrets.token_urlsafe(24)
    uid = "e7perf_" + uuid.uuid4().hex[:12]
    user = User(id=uid, email=f"{uid}@example.invalid", password_hash=get_password_hash(password), role="Admin",
                display_name="E7 perf scratch", is_active=True, is_verified=True)
    db.add(user)
    db.commit()
    del password
    token = create_access_token({"sub": uid, "user_id": uid, "email": user.email, "token_version": user.token_version})
    headers = {"Authorization": f"Bearer {token}"}

    j4_base = db.execute(select(func.max(CalibrationState.review_index))
                         .where(CalibrationState.store_id == store)).scalar()
    sel_id = f"{store}_e7perf_{uuid.uuid4().hex[:6]}"
    try:
        # ---- (b) endpoints
        s = store
        endpoints = [
            ("dashboard", "GET", "/api/v1/dashboard/kpis", {"store_id": s}),
            ("dashboard", "GET", "/api/v1/dashboard/kpis", {}),
            ("dashboard", "GET", "/api/v1/dashboard/demand-trend", {"store_id": s, "days": 30}),
            ("dashboard", "GET", "/api/v1/dashboard/alerts", {"store_id": s, "limit": 50}),
            ("dashboard", "GET", "/api/v1/dashboard/overview", {"store_id": s}),
            ("dashboard", "GET", "/api/v1/dashboard/kpi-dashboard", {"store_id": s}),
            ("reports", "GET", "/api/v1/reports/forecast-accuracy", {"store_id": s}),
            ("reports", "GET", "/api/v1/reports/inventory-performance", {"store_id": s, "limit": 50}),
            ("reports", "GET", "/api/v1/reports/cost-comparison", {"store_id": s}),
            ("reports", "GET", "/api/v1/reports/policy-comparison", {}),
            ("inventory-screen", "GET", "/api/v1/inventory-screen", {"store_id": s, "limit": 50}),
            ("inventory-screen", "GET", "/api/v1/inventory-screen",
             {"store_id": s, "limit": 50, "sort_by": "stock_value", "sort_dir": "desc"}),
            ("forecast-explorer", "GET", "/api/v1/forecast-explorer/window", {"store_id": s, "item_id": item_id}),
            ("metrics", "GET", "/api/v1/metrics/forecast-quality", {"store_id": s}),
            ("metrics", "GET", "/api/v1/metrics/controller", {"store_id": s}),
        ]
        results = []
        client = TestClient(app)   # no context manager: no lifespan, no scheduler, no listener
        for group, method, path, params in endpoints:
            lat, codes = [], set()
            t0 = time.perf_counter()
            r0 = client.request(method, path, params=params, headers=headers)
            cold = (time.perf_counter() - t0) * 1000.0
            codes.add(r0.status_code)
            size = len(r0.content)
            for _ in range(args.repeat):
                t0 = time.perf_counter()
                r = client.request(method, path, params=params, headers=headers)
                lat.append((time.perf_counter() - t0) * 1000.0)
                codes.add(r.status_code)
            row = {"group": group, "path": path, "params": params, "status": sorted(codes), "bytes": size,
                   "cold_ms": round(cold, 1), "p50_ms": round(statistics.median(lat), 1),
                   "p95_ms": round(pct(lat, 0.95), 1), "max_ms": round(max(lat), 1), "n": len(lat)}
            if item_id and "item_id" in params:
                row["params"] = {**params, "item_id": "<first classified SKU>"}
            results.append(row)
            print(f"{path:48s} {sorted(codes)} cold {row['cold_ms']:8.1f}  p50 {row['p50_ms']:8.1f}  "
                  f"p95 {row['p95_ms']:8.1f}  max {row['max_ms']:8.1f}", flush=True)
        rep["endpoints"] = results

        # ---- (c) J4 / J5
        review_date = clock.current_date
        j4 = []
        base = int(j4_base or 0)
        for k in range(args.j4_repeats):
            idx = base + 1 + k
            t0 = time.perf_counter()
            calibrator_service.run_calibration_step(db=db, store_id=store, review_index=idx, review_date=review_date,
                                                    lead_time_days=3, review_period_days=7)
            j4.append(time.perf_counter() - t0)
            print(f"J4 step {k}: {j4[-1]:.2f} s", flush=True)
        rep["j4"] = {"seconds": [round(x, 3) for x in j4], "first_s": round(j4[0], 3),
                     "median_s": round(statistics.median(j4), 3), "skus": int(n_class)}
        # J4 also recomputes (s, S) for every SKU of the store (the part that scales with the SKU count)
        t0 = time.perf_counter()
        optimization_service.recompute_parameters(db, store_id=store)
        db.commit()
        rep["j4_params"] = {"seconds": round(time.perf_counter() - t0, 3), "skus": int(n_class)}
        print(f"J4 recompute_parameters: {rep['j4_params']['seconds']} s", flush=True)
        j5 = None
        if not args.skip_j5:
            t0 = time.perf_counter()
            res = optimization_service.refit_quarterly_policies(db, store_id=store, selection_id=sel_id)
            j5 = time.perf_counter() - t0
            print(f"J5 refit: {j5:.1f} s ({len(res)} class rows)", flush=True)
            rep["j5"] = {"seconds": round(j5, 2), "class_rows": len(res), "skus": int(n_class),
                         "origin_clock_date": str(review_date), "selection_id": sel_id}
    finally:
        db.rollback()
        # remove everything this script wrote
        db.query(CalibrationState).filter(CalibrationState.store_id == store,
                                          CalibrationState.review_index > int(j4_base or 0)).delete(
            synchronize_session=False)
        db.query(PolicySelection).filter(PolicySelection.selection_id.like(f"{store}_e7perf_%")).delete(
            synchronize_session=False)
        db.query(User).filter(User.id == uid).delete(synchronize_session=False)
        db.commit()
        db.close()

    # ---- extrapolation (linear, clearly marked)
    j4s = rep["j4"]["median_s"]
    ex = {"method": "LINEAR EXTRAPOLATION, not measured",
          "j4_to_8831_skus_s": round(j4s * TARGET_SKUS / max(1, n_class), 2)}
    pj = rep["j4_params"]["seconds"]
    ex["j4_params_to_8831_skus_s"] = round(pj * TARGET_SKUS / max(1, n_class), 2)
    ex["j4_total_to_8831_skus_s"] = round(ex["j4_to_8831_skus_s"] + ex["j4_params_to_8831_skus_s"], 2)
    if "j5" in rep:
        ex["j5_to_3_stores_s_sequential"] = round(rep["j5"]["seconds"] * TARGET_STORES, 1)
    rep["extrapolation"] = ex

    # ---- verdicts
    dash = [e for e in rep["endpoints"] if e["group"] == "dashboard"]
    rep["verdicts"] = {
        "dashboard_p95_lt_2s": all(e["p95_ms"] < P95_LIMIT_MS and e["status"] == [200] for e in dash),
        "all_endpoints_p95_lt_2s": all(e["p95_ms"] < P95_LIMIT_MS and e["status"] == [200] for e in rep["endpoints"]),
        "j4_c3_step_measured_le_5s": j4s <= J4_LIMIT_S,
        "j4_c3_step_extrapolated_8831_le_5s": ex["j4_to_8831_skus_s"] <= J4_LIMIT_S,
        "j4_full_measured_le_5s": j4s + rep["j4_params"]["seconds"] <= J4_LIMIT_S,
        "j4_full_extrapolated_8831_le_5s": ex["j4_total_to_8831_skus_s"] <= J4_LIMIT_S,
    }
    if "j5" in rep:
        rep["verdicts"]["j5_measured_le_5min"] = rep["j5"]["seconds"] <= J5_LIMIT_S
        rep["verdicts"]["j5_extrapolated_3_stores_le_5min"] = ex["j5_to_3_stores_s_sequential"] <= J5_LIMIT_S

    if args.out_json:
        with open(args.out_json, "w", encoding="utf-8") as f:
            json.dump(rep, f, indent=1, default=str)
    if args.out_md:
        os.makedirs(os.path.dirname(os.path.abspath(args.out_md)), exist_ok=True)
        with open(args.out_md, "w", encoding="utf-8") as f:
            f.write(render_md(rep))
    print(json.dumps({"verdicts": rep["verdicts"], "extrapolation": ex}, indent=1))
    return 0


def render_md(r: dict) -> str:
    m, d, v, ex = r["machine"], r["data"], r["verdicts"], r["extrapolation"]
    ok = lambda b: "PASS" if b else "FAIL"  # noqa: E731
    L = ["# E7 performance report (RQ6)\n",
         f"Generated {r['generated_at']} on database `{r['database']}` (local sandbox), store {r['store']}.\n",
         "## Setup\n",
         f"- Machine: {m['os']}, {m['cpu_count_logical']} logical CPUs ({m.get('processor','')}), "
         f"RAM {m.get('ram_total_gb')} GB (available at start {m.get('ram_available_gb_at_start')} GB).",
         f"- Database: {r['postgres_version']}, size {r['db_size_bytes'] / 2 ** 30:.2f} GB, "
         "PostgreSQL in a Docker container on the same Windows host (loopback), Python 3.12 backend in-process.",
         f"- Data of {r['store']}: {d['classified_skus']} classified SKUs, {d['inventory_rows']} inventory rows; "
         f"simulation clock {d['sim_clock_start']} -> {d['sim_clock_current']}.",
         f"- Endpoints: FastAPI TestClient (in-process, no HTTP/TCP, no browser), Admin token of a scratch user, "
         f"1 cold call then {r['repeat']} warm calls per endpoint; p50/p95/max over the warm calls.\n",
         "## Endpoint latency (ms)\n",
         "| Group | Endpoint | Params | HTTP | KB | Cold | p50 | p95 | Max |",
         "|---|---|---|---|---|---|---|---|---|"]
    for e in r["endpoints"]:
        ps = ", ".join(f"{k}={v_}" for k, v_ in e["params"].items()) or "-"
        L.append(f"| {e['group']} | `{e['path'].replace('/api/v1', '')}` | {ps} | {e['status']} | "
                 f"{e['bytes'] / 1024:.0f} | {e['cold_ms']:.0f} | {e['p50_ms']:.0f} | {e['p95_ms']:.0f} | "
                 f"{e['max_ms']:.0f} |")
    L += ["", "## Jobs\n",
          f"- J4 C3-OUT step ({d['classified_skus']} SKU, 9 classes): runs "
          f"{r['j4']['seconds']} s, median {r['j4']['median_s']} s (class-level update from service_outcomes).",
          f"- J4 parameter update `recompute_parameters` ((s, S) of every SKU): {r['j4_params']['seconds']} s."]
    if "j5" in r:
        L.append(f"- J5 refit ({d['classified_skus']} SKU, full 140-candidate grid, simulated from the simulation "
                 f"start to clock date {r['j5']['origin_clock_date']}): {r['j5']['seconds']} s.")
    L += ["", "## Extrapolation (NOT MEASURED, linear)\n",
          f"- J4 to {TARGET_SKUS} SKU: (C3 step + parameter update) x {TARGET_SKUS}/{d['classified_skus']} = "
          f"{ex['j4_total_to_8831_skus_s']} s."]
    if "j5_to_3_stores_s_sequential" in ex:
        L.append(f"- J5 to {TARGET_STORES} stores run sequentially: {ex['j5_to_3_stores_s_sequential']} s "
                 f"(= {ex['j5_to_3_stores_s_sequential'] / 60:.1f} min).")
    L += ["", "## Pass/fail against the teacher's thresholds\n",
          "| Criterion | Threshold | Result | Verdict |", "|---|---|---|---|"]
    dash = [e for e in r["endpoints"] if e["group"] == "dashboard"]
    allp = max(e["p95_ms"] for e in r["endpoints"])
    L.append(f"| Dashboard API p95 | < 2000 ms | worst dashboard p95 {max(e['p95_ms'] for e in dash):.0f} ms "
             f"| {ok(v['dashboard_p95_lt_2s'])} |")
    L.append(f"| All screens' API p95 (extra) | < 2000 ms | worst p95 {allp:.0f} ms | {ok(v['all_endpoints_p95_lt_2s'])} |")
    L.append(f"| J4 C3-OUT step only, measured ({d['classified_skus']} SKU) | a few seconds (read as <= 5 s) | "
             f"{r['j4']['median_s']} s | {ok(v['j4_c3_step_measured_le_5s'])} |")
    L.append(f"| J4 C3-OUT step only, extrapolated to {TARGET_SKUS} SKU | <= 5 s | {ex['j4_to_8831_skus_s']} s "
             f"(extrapolation; the step is class-level, so it barely scales with SKUs) | "
             f"{ok(v['j4_c3_step_extrapolated_8831_le_5s'])} |")
    L.append(f"| J4 full (C3 step + (s, S) update of all SKUs), measured | <= 5 s | "
             f"{r['j4']['median_s'] + r['j4_params']['seconds']:.1f} s | {ok(v['j4_full_measured_le_5s'])} |")
    L.append(f"| J4 full, extrapolated to {TARGET_SKUS} SKU | <= 5 s | {ex['j4_total_to_8831_skus_s']} s "
             f"(extrapolation) | {ok(v['j4_full_extrapolated_8831_le_5s'])} |")
    if "j5" in r:
        L.append(f"| J5, measured (1 store, 1 refit) | a few minutes (read as <= 5 min) | {r['j5']['seconds']} s | "
                 f"{ok(v['j5_measured_le_5min'])} |")
        L.append(f"| J5, extrapolated to 3 stores | a few minutes (<= 5 min) | "
                 f"{ex['j5_to_3_stores_s_sequential']} s (extrapolation) | {ok(v['j5_extrapolated_3_stores_le_5min'])} |")
    L.append("| Batch review 30,490 SKU | < 10 min | not measured (out of scope) | n/a |")
    slow = [e for e in r["endpoints"] if e["p95_ms"] >= P95_LIMIT_MS or e["cold_ms"] >= P95_LIMIT_MS]
    L += ["", "## Notes and limits\n"]
    for e in slow:
        L.append(f"- FLAG: `{e['path'].replace('/api/v1', '')}` cold {e['cold_ms']:.0f} ms, warm p95 "
                 f"{e['p95_ms']:.0f} ms (>= 2000 ms in at least one of them).")
    L += [
          "- Single machine, Windows, PostgreSQL 16 in Docker (loopback); no concurrent users, no network or browser "
          "time (TestClient is in-process). A real deployment adds HTTP and rendering time.",
          "- The first call of an endpoint is reported as Cold (SQLAlchemy/connection pool, Python module and "
          "statement caches, PostgreSQL buffer cache); p50/p95/max are warm. The database (1.7 GB) fits in the "
          "OS/Postgres cache after the first calls, so warm numbers are the best case.",
          "- With 20 samples p95 is essentially the second-largest value, and max the single worst sample.",
          "- J4 is timed on the existing `calibrator_service.run_calibration_step` (the 9-class controller update, "
          "which reads service_outcomes of the matured cycle). It scales with the number of SKUs only through the "
          "queries it runs, so the linear extrapolation is conservative or optimistic depending on the query plan: "
          "treat it as an estimate.",
          "- J5 is timed as one refit at the CURRENT clock date: the engine simulates every candidate continuously "
          "from the simulation start, so the cost grows with the elapsed days (here the clock is at the end of the "
          "test year, i.e. the largest refit of the year). The 3-store figure assumes sequential runs and linear "
          "scaling; it ignores parallelism (stores are independent and could run in parallel on the available CPUs).",
          "- Rows written by the job timings (calibration_state, policy_selection) and the scratch user were removed "
          "after the run.",
          "- The J4 step is timed alone (not J3 window quantiles, parameter recompute and order generation of the "
          "full review).", ""]
    return "\n".join(L)


if __name__ == "__main__":
    raise SystemExit(main())
