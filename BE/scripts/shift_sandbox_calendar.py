"""Shift every simulated date of the LOCAL replay database by whole weeks (e.g. the 2015-16 test year to 2025-26).

    python scripts/shift_sandbox_calendar.py --to-start 2025-11-24     # the CA_1 clock start becomes this Monday
    python scripts/shift_sandbox_calendar.py --days 3836               # or an explicit shift (a multiple of 7)

What it does, in one transaction per table:
  * every ``date`` column of every table is moved by N days (sales, prices, calendar, events, forecasts, quantile
    origins, clock, simulation state, proposals, batch runs, service outcomes, ...);
  * calendar.year / calendar.month are recomputed from the new date;
  * replenishment rows whose created_at was derived from their review date (simulator proposals) move with it;
  * the system setting ``replay_calendar`` records the new date of M5 d_1 (``{"m5_day0", "shift_days"}``), which
    the API and load_teacher_data.py read at start (policy_config.load_calendar_setting), so every day index of the
    teacher artifacts still maps to the right (shifted) date.

N must be a multiple of 7: weekdays, review Mondays, weekly seasonality and therefore every simulated number stay
exactly the same; only the dates shown change. Real timestamps (created_at, started_at of runs, logins) are not
touched. Run it on a database WITHOUT another connection (stop the API first), then save a snapshot.

SAFETY: same guard as demo_snapshot.py: a PostgreSQL database on localhost whose name starts with dfios_sandbox.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, timedelta

sys.dont_write_bytecode = True
BE_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
if BE_DIR not in sys.path:
    sys.path.insert(0, BE_DIR)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from demo_snapshot import sandbox_target  # noqa: E402  (loads BE/.env, localhost dfios_sandbox* guard)

SETTING_KEY = "replay_calendar"
M5_DAY0 = date(2011, 1, 29)
VACUUM_MIN_BYTES = 50 * 1024 * 1024  # rewrite big tables right away so the dead row versions do not pile up


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--days", type=int, help="shift in days (a multiple of 7, may be negative)")
    g.add_argument("--to-start", help="new clock start date of --store (YYYY-MM-DD, same weekday as today's start)")
    ap.add_argument("--store", default="CA_1")
    ap.add_argument("--dry-run", action="store_true", help="list what would change, write nothing")
    args = ap.parse_args(argv)

    import psycopg2

    kw, db = sandbox_target(os.environ.get("DATABASE_URL", ""))
    conn = psycopg2.connect(**{**kw, "dbname": db})
    cur = conn.cursor()

    cur.execute('select start_date from sim_clock where store_id = %s', (args.store,))
    row = cur.fetchone()
    if args.to_start:
        if row is None:
            raise SystemExit(f"no sim_clock row for {args.store}: use --days")
        n = (date.fromisoformat(args.to_start) - row[0]).days
    else:
        n = int(args.days)
    if n == 0:
        print("nothing to do: shift is 0 days")
        return 0
    if n % 7:
        raise SystemExit(f"refusing: {n} days is not a whole number of weeks (weekdays and results would change)")

    cur.execute("select value from system_settings where key = %s", (SETTING_KEY,))
    prev = cur.fetchone()
    old_day0 = date.fromisoformat(prev[0]["m5_day0"]) if prev and prev[0] and prev[0].get("m5_day0") else M5_DAY0
    old_shift = int(prev[0].get("shift_days", 0)) if prev and prev[0] else 0
    new_day0 = old_day0 + timedelta(days=n)

    cur.execute("""
        select c.table_name, c.column_name from information_schema.columns c
        join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.data_type = 'date'
        order by c.table_name, c.column_name""")
    cols = cur.fetchall()
    print(f"database {db}: shift {n:+d} days ({n // 7:+d} weeks); d_1 {old_day0} -> {new_day0}")
    if row is not None:
        print(f"clock start of {args.store}: {row[0]} -> {row[0] + timedelta(days=n)}")
    if args.dry_run:
        for t, c in cols:
            print(f"  would shift {t}.{c}")
        return 0

    by_table = {}
    for t, c in cols:
        by_table.setdefault(t, []).append(c)
    for t, cs in by_table.items():
        if t == "replenishment_recommendations":
            # simulator proposals carry created_at = review day at midnight: keep them on their (shifted) review day
            cur.execute(f'update "{t}" set created_at = created_at + make_interval(days => %s) '
                        f'where review_date is not null and created_at::date = review_date', (n,))
        sets = ", ".join(f'"{c}" = "{c}" + %s' for c in cs)
        cur.execute(f'update "{t}" set {sets}', [n] * len(cs))
        changed = cur.rowcount
        if t == "calendar":
            cur.execute('update calendar set year = extract(year from date)::int, month = extract(month from date)::int')
        conn.commit()
        print(f"  {t}: {', '.join(cs)} ({changed} rows)")
        cur.execute("select pg_total_relation_size(%s)", (t,))
        if cur.fetchone()[0] >= VACUUM_MIN_BYTES:
            conn.autocommit = True
            cur.execute(f'vacuum full analyze "{t}"')
            conn.autocommit = False

    value = {"m5_day0": new_day0.isoformat(), "shift_days": old_shift + n,
             "note": "dates shifted as a whole by scripts/shift_sandbox_calendar.py (whole weeks)"}
    cur.execute("""insert into system_settings (key, value, description, updated_at)
                   values (%s, %s::json, %s, now())
                   on conflict (key) do update set value = excluded.value, updated_at = now()""",
                (SETTING_KEY, json.dumps(value), "Replay calendar: date of M5 d_1 after a whole-week date shift"))
    conn.commit()
    print(f"setting {SETTING_KEY} = {value}")
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
