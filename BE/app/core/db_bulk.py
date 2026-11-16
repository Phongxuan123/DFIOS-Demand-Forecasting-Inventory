"""
Nạp dữ liệu hàng loạt (bulk load) cho PostgreSQL bằng COPY, có fallback INSERT cho SQLite.

Quy ước an toàn (P-11 / R-33 / R-34):
- COPY chạy trên CHÍNH connection mà pandas/SQLAlchemy truyền vào, nên thuộc cùng transaction
  với các lệnh DELETE trước đó. Không tự commit, không tự rollback.
- Lỗi KHÔNG bị nuốt: COPY lỗi thì exception nổi lên, transaction bên ngoài rollback toàn bộ
  (kể cả DELETE), dữ liệu cũ còn nguyên.
- `data_iter` được vật chất hóa đúng một lần, không có chuyện fallback đọc lại iterator đã cạn.
- Dùng `replace_rows()` khi cần "xóa rồi nạp lại" một cách nguyên tử.
"""
import csv
from io import StringIO
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import text


def _is_postgres(conn: Any) -> bool:
    dialect = getattr(conn, "dialect", None)
    if dialect is None:
        engine = getattr(conn, "engine", None)
        dialect = getattr(engine, "dialect", None)
    return getattr(dialect, "name", "") == "postgresql"


def _dbapi_connection(conn: Any) -> Any:
    """Trả về DBAPI connection đang được `conn` (SQLAlchemy Connection) sử dụng."""
    raw = getattr(conn, "connection", None)
    if raw is None:
        raise RuntimeError("psql_insert_copy cần một SQLAlchemy Connection đang mở")
    return getattr(raw, "driver_connection", None) or getattr(raw, "dbapi_connection", None) or raw


def psql_insert_copy(table: Any, conn: Any, keys: List[str], data_iter: Iterable[Any]) -> None:
    """
    Callable cho `DataFrame.to_sql(method=psql_insert_copy)`.

    PostgreSQL: `COPY ... FROM STDIN (FORMAT CSV)` trên chính connection/transaction của `conn`.
    DB khác (SQLite trong test): INSERT nhiều dòng qua SQLAlchemy.
    Mọi lỗi đều được ném ra cho nơi gọi.
    """
    rows = [tuple(row) for row in data_iter]
    if not rows:
        return

    if not _is_postgres(conn):
        conn.execute(table.table.insert(), [dict(zip(keys, row)) for row in rows])
        return

    buf = StringIO()
    writer = csv.writer(buf, delimiter=",", quoting=csv.QUOTE_MINIMAL)
    for row in rows:
        writer.writerow(["" if value is None else value for value in row])
    buf.seek(0)

    columns = ", ".join(f'"{k}"' for k in keys)
    table_name = f'"{table.schema}"."{table.name}"' if table.schema else f'"{table.name}"'
    sql = f"COPY {table_name} ({columns}) FROM STDIN WITH (FORMAT CSV)"

    dbapi_conn = _dbapi_connection(conn)
    cur = dbapi_conn.cursor()
    try:
        cur.copy_expert(sql=sql, file=buf)
    finally:
        cur.close()


def replace_rows(
    conn: Any,
    table_name: str,
    df: Any,
    delete_sql: Optional[str] = None,
    delete_params: Optional[Dict[str, Any]] = None,
) -> int:
    """
    "Xóa rồi nạp lại" nguyên tử trên MỘT connection.

    `conn` phải là SQLAlchemy Connection đang nằm trong transaction, ví dụ:

        with engine.begin() as conn:
            replace_rows(conn, "alerts", df, "DELETE FROM alerts WHERE store_id = :s", {"s": "CA_1"})

    hoặc `db.connection()` của một Session (transaction do Session quản lý, nơi gọi tự commit).
    Nếu COPY lỗi, exception nổi lên và transaction rollback cả lệnh DELETE.
    Trả về số dòng đã nạp.
    """
    if delete_sql:
        conn.execute(text(delete_sql), delete_params or {})
    if df is None or len(df) == 0:
        return 0
    df.to_sql(table_name, conn, if_exists="append", index=False, method=psql_insert_copy)
    return int(len(df))
