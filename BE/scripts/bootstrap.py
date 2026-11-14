"""
Một lệnh dựng toàn bộ DB DFIOS trên database trống (P-04 / P-05 / FIX_PLAN Phase 0).

Chạy từ thư mục BE/:
    python scripts/bootstrap.py                # DB trống hoặc đã có (loader idempotent)
    python scripts/bootstrap.py --reset        # DROP + CREATE schema public trước (chỉ localhost)
    python scripts/bootstrap.py --reset --i-know   # cho phép reset DB không phải localhost (NGUY HIỂM)
    python scripts/bootstrap.py --skip-checksum    # bỏ sha256 artifact (chỉ kiểm tra tồn tại + kích thước)
    python scripts/bootstrap.py --from load_inventory   # chạy tiếp từ một bước (sau khi sửa lỗi)

Các bước: kiểm tra artifact -> init_tables -> loader (đúng thứ tự phụ thuộc) -> seed_demo ->
sync_scientific_baseline. Bất kỳ bước nào lỗi sẽ dừng ngay, in tên bước + mã thoát, exit code != 0.
Biến môi trường cần: DATABASE_URL, M5_SALES_CSV_PATH, M5_CALENDAR_CSV_PATH, ADMIN/MANAGER/VIEWER_PASSWORD
(đọc từ BE/.env nếu có), DFIOS_ARTIFACTS_DIR (mặc định BE/scripts).
"""
import argparse
import os
import subprocess
import sys
import time
from urllib.parse import urlparse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BE_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
sys.path.insert(0, BE_DIR)
sys.path.insert(0, SCRIPT_DIR)

# Thứ tự = thứ tự phụ thuộc dữ liệu. Mỗi mục là một script trong scripts/.
STEPS = [
    "init_tables",
    "load_users",
    "load_suppliers",
    "load_calendar",
    "load_events",
    "load_products",
    "load_sales_history",
    "load_forecast",
    "load_backtest_forecasts",
    "load_forecast_window_quantile",
    "load_inventory_params",
    "load_c3out_data",
    "load_inventory",
    "load_inventory_daily",
    "load_sim_clock",
    "load_policy_selection",
    "load_calibration_state",
    "load_service_outcomes",
    "load_replenishment",
    "load_alerts",
    "load_model_registry",
    "load_data_imports",
    "seed_demo",
    "sync_scientific_baseline",
]

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(BE_DIR, ".env"))  # không ghi đè biến môi trường đã đặt
    except ImportError:
        pass


def _db_host(url: str) -> str:
    return (urlparse(url.replace("+psycopg2", "")).hostname or "").lower()


def _fmt(seconds: float) -> str:
    return f"{seconds:6.1f}s"


def reset_schema(url: str) -> None:
    from sqlalchemy import create_engine, text
    engine = create_engine(url, isolation_level="AUTOCOMMIT")
    with engine.connect() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true", help="DROP/CREATE schema public trước khi dựng")
    parser.add_argument("--i-know", dest="i_know", action="store_true", help="cho phép --reset trên DB không phải localhost")
    parser.add_argument("--skip-checksum", action="store_true", help="chỉ kiểm tra tồn tại + kích thước artifact")
    parser.add_argument("--from", dest="start_from", default=None, help="bắt đầu từ bước này")
    args = parser.parse_args()

    _load_dotenv()
    url = os.getenv("DATABASE_URL", "postgresql+psycopg2://dfios:dfios123@localhost:5432/dfios")
    host = _db_host(url)
    total_start = time.time()
    timings = []

    print(f"[bootstrap] database host={host} name={urlparse(url.replace('+psycopg2', '')).path.lstrip('/')}")

    # 1. Artifact check (fail loudly)
    t0 = time.time()
    import check_artifacts
    problems = check_artifacts.check(quick=args.skip_checksum)
    if problems:
        print("[bootstrap] ARTIFACT CHECK FAILED:", file=sys.stderr)
        for p in problems:
            print("  " + p, file=sys.stderr)
        print("Obtain the files from the project owner, then re-run. Nothing was changed.", file=sys.stderr)
        return 1
    timings.append(("check_artifacts", time.time() - t0))
    print(f"[bootstrap] artifacts OK ({_fmt(time.time() - t0)})")

    # 2. Reset
    if args.reset:
        if host not in LOCAL_HOSTS and not args.i_know:
            print(
                f"[bootstrap] REFUSING --reset: DATABASE_URL host '{host}' is not localhost/127.0.0.1. "
                "Pass --i-know to override (destroys ALL data in that database).",
                file=sys.stderr,
            )
            return 2
        t0 = time.time()
        reset_schema(url)
        timings.append(("reset_schema", time.time() - t0))
        print(f"[bootstrap] schema reset ({_fmt(time.time() - t0)})")

    steps = STEPS
    if args.start_from:
        if args.start_from not in STEPS:
            print(f"Unknown step '{args.start_from}'. Valid: {', '.join(STEPS)}", file=sys.stderr)
            return 2
        steps = STEPS[STEPS.index(args.start_from):]

    env = dict(os.environ)
    env.setdefault("PYTHONIOENCODING", "utf-8")
    env.setdefault("DFIOS_ARTIFACTS_DIR", SCRIPT_DIR)
    for i, step in enumerate(steps, 1):
        path = os.path.join(SCRIPT_DIR, f"{step}.py")
        if not os.path.exists(path):
            print(f"[bootstrap] step script missing: {path}", file=sys.stderr)
            return 1
        print(f"\n[bootstrap] ({i}/{len(steps)}) {step} ...", flush=True)
        t0 = time.time()
        rc = subprocess.call([sys.executable, path], cwd=BE_DIR, env=env)
        dt = time.time() - t0
        timings.append((step, dt))
        if rc != 0:
            print(f"\n[bootstrap] FAILED at step '{step}' (exit code {rc}) after {_fmt(dt)}. "
                  f"Fix it and resume with: python scripts/bootstrap.py --from {step}", file=sys.stderr)
            return rc
        print(f"[bootstrap] {step} done ({_fmt(dt)})", flush=True)

    print("\n[bootstrap] Timings:")
    for name, dt in timings:
        print(f"  {name:32s} {_fmt(dt)}")
    print(f"[bootstrap] TOTAL {_fmt(time.time() - total_start)} - database ready.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
