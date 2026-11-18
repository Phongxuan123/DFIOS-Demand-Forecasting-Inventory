"""Demo snapshots of the LOCAL replay database (demo.md §5 "snapshot DB ... khôi phục trong vài giây", §7 step 10).

A snapshot is a full copy of the sandbox database made with ``CREATE DATABASE ... TEMPLATE`` (a file-level copy
inside PostgreSQL: seconds, versus minutes for pg_dump / pg_restore of the ~2 GB replay year).

    python scripts/demo_snapshot.py save demo_start      # dfios_sandbox -> dfios_sandbox__snap_demo_start
    python scripts/demo_snapshot.py restore demo_start   # dfios_sandbox__snap_demo_start -> dfios_sandbox
    python scripts/demo_snapshot.py list
    python scripts/demo_snapshot.py delete demo_start

Typical demo preparation (clock milestones of demo.md §7):
    demo_start  clock at the first test day (2015-05-25, d_1577), J5 selection #0, nothing simulated
    d1759       clock at 2015-11-23 (d_1759), the start of the model-degradation scenario (step 10)

RESOURCES: each snapshot is a full copy (~2.2 GB for the replay year) inside Docker's virtual disk, which never
shrinks on its own; keep several GB free on the drive that holds it (Docker Desktop > Settings > Resources >
Disk image location) and enough free RAM: a template copy under memory pressure can restart the Docker VM
(PostgreSQL then recovers from its WAL; nothing is lost, the copy is simply not created).

SAFETY: DATABASE_URL must be a PostgreSQL URL on localhost / 127.0.0.1 whose database starts with ``dfios_sandbox``
(the same guard as load_teacher_data.py). A template copy needs the source database to have NO other connection,
so stop the API / worker that use it first; ``--force`` terminates those connections instead.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time
from urllib.parse import urlparse

sys.dont_write_bytecode = True
BE_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
if BE_DIR not in sys.path:
    sys.path.insert(0, BE_DIR)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(BE_DIR, ".env"))

SANDBOX_PREFIX = "dfios_sandbox"
SNAP_SEP = "__snap_"
NAME_RE = re.compile(r"^[a-z0-9_]{1,30}$")


def sandbox_target(url: str):
    """(connection kwargs for the maintenance db, sandbox db name); raises unless local dfios_sandbox*."""
    p = urlparse((url or "").replace("+psycopg2", "").replace("+psycopg", ""))
    if not (p.scheme or "").startswith("postgres"):
        raise SystemExit("refusing: DATABASE_URL is not PostgreSQL")
    if (p.hostname or "").lower() not in ("localhost", "127.0.0.1"):
        raise SystemExit(f"refusing: host '{p.hostname}' is not localhost")
    db = (p.path or "").lstrip("/")
    if not db.startswith(SANDBOX_PREFIX) or SNAP_SEP in db:
        raise SystemExit(f"refusing: database '{db}' does not start with '{SANDBOX_PREFIX}'")
    kw = {"host": p.hostname, "port": p.port or 5432, "user": p.username, "password": p.password,
          "dbname": "postgres"}
    return kw, db


def snap_name(db: str, name: str) -> str:
    if not NAME_RE.match(name):
        raise SystemExit("snapshot name: lowercase letters, digits and _ only (max 30)")
    return f"{db}{SNAP_SEP}{name}"


def _connect(kw):
    import psycopg2

    conn = psycopg2.connect(**kw)
    conn.autocommit = True   # CREATE / DROP DATABASE cannot run in a transaction
    return conn


def _exists(cur, db: str) -> bool:
    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db,))
    return cur.fetchone() is not None


def _others(cur, db: str) -> int:
    cur.execute("SELECT count(*) FROM pg_stat_activity WHERE datname = %s AND pid <> pg_backend_pid()", (db,))
    return int(cur.fetchone()[0])


def _free(cur, db: str, force: bool) -> None:
    n = _others(cur, db)
    if n and not force:
        raise SystemExit(f"database '{db}' has {n} open connection(s): stop the API/worker using it, or pass --force")
    if n:
        cur.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s "
                    "AND pid <> pg_backend_pid()", (db,))


def _q(ident: str) -> str:
    return '"' + ident.replace('"', '""') + '"'


def cmd_save(cur, db: str, name: str, force: bool) -> None:
    snap = snap_name(db, name)
    if _exists(cur, snap):
        if not force:
            raise SystemExit(f"snapshot '{name}' exists; pass --force to replace it")
        _free(cur, snap, True)
        cur.execute(f"DROP DATABASE {_q(snap)}")
    _free(cur, db, force)
    t = time.time()
    cur.execute(f"CREATE DATABASE {_q(snap)} TEMPLATE {_q(db)}")
    print(f"saved {db} -> {snap} in {time.time() - t:.1f}s")


def cmd_restore(cur, db: str, name: str, force: bool) -> None:
    snap = snap_name(db, name)
    if not _exists(cur, snap):
        raise SystemExit(f"no snapshot '{name}' ({snap})")
    t = time.time()
    if _exists(cur, db):
        _free(cur, db, force)
        cur.execute(f"DROP DATABASE {_q(db)}")
    cur.execute(f"CREATE DATABASE {_q(db)} TEMPLATE {_q(snap)}")
    print(f"restored {snap} -> {db} in {time.time() - t:.1f}s")


def cmd_list(cur, db: str) -> None:
    cur.execute("SELECT datname, pg_size_pretty(pg_database_size(datname)) FROM pg_database "
                "WHERE datname LIKE %s ORDER BY datname", (f"{db}{SNAP_SEP}%",))
    rows = cur.fetchall()
    if not rows:
        print("no snapshots")
    for name, size in rows:
        print(f"{name.split(SNAP_SEP, 1)[1]:<20} {size:>10}  ({name})")


def cmd_delete(cur, db: str, name: str) -> None:
    snap = snap_name(db, name)
    if not _exists(cur, snap):
        raise SystemExit(f"no snapshot '{name}'")
    _free(cur, snap, True)
    cur.execute(f"DROP DATABASE {_q(snap)}")
    print(f"deleted {snap}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", choices=["save", "restore", "list", "delete"])
    ap.add_argument("name", nargs="?")
    ap.add_argument("--force", action="store_true", help="terminate open connections / replace an existing snapshot")
    a = ap.parse_args(argv)
    kw, db = sandbox_target(os.getenv("DATABASE_URL", ""))
    if a.action != "list" and not a.name:
        ap.error("a snapshot name is required")
    conn = _connect(kw)
    try:
        cur = conn.cursor()
        if a.action == "save":
            cmd_save(cur, db, a.name, a.force)
        elif a.action == "restore":
            cmd_restore(cur, db, a.name, a.force)
        elif a.action == "delete":
            cmd_delete(cur, db, a.name)
        else:
            cmd_list(cur, db)
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
