"""
Nâng cấp schema tại chỗ cho DB đã tồn tại (dự án chưa dùng Alembic).

`Base.metadata.create_all()` chỉ tạo bảng còn thiếu, không thêm cột vào bảng cũ. Các bước dưới đây
idempotent, chỉ chạy trên PostgreSQL và được gọi từ `scripts/init_tables.py` / `scripts/bootstrap.py`.
"""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


# Bảng có bước nâng cấp riêng (đổi khóa, backfill) bên dưới, không đụng bằng bước tổng quát.
_CUSTOM_UPGRADE_TABLES = {"sku_classifications"}


def _reconcile_columns(engine: Engine, base) -> list[str]:
    """
    Bước tổng quát, chỉ THÊM/NỚI, không xóa dữ liệu:
    - cột có trong model nhưng thiếu trong DB -> ADD COLUMN (cho phép NULL);
    - cột model KHAI BÁO RÕ nullable=True nhưng DB còn NOT NULL (khác khóa chính) -> DROP NOT NULL.
      R5B-10: cột chỉ "mặc định" nullable trong ORM (không khai báo) giữ nguyên NOT NULL của DB.
    Cần cho DB tạo bởi phiên bản code cũ (ví dụ policy_selection.val_cost giờ được để trống khi chưa đo).
    """
    applied: list[str] = []
    insp = inspect(engine)
    existing_tables = set(insp.get_table_names())
    for table in base.metadata.sorted_tables:
        if table.name not in existing_tables or table.name in _CUSTOM_UPGRADE_TABLES:
            continue
        db_cols = {c["name"]: c for c in insp.get_columns(table.name)}
        pk = {c.name for c in table.primary_key.columns}
        for col in table.columns:
            if col.name not in db_cols:
                col_type = col.type.compile(dialect=engine.dialect)
                with engine.begin() as conn:
                    conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {col_type}'))
                applied.append(f"{table.name}.{col.name}")
            elif (
                col.nullable and col._user_defined_nullable is True  # R5B-10: only EXPLICIT nullable=True columns
                and col.name not in pk and not db_cols[col.name].get("nullable", True)
            ):
                with engine.begin() as conn:
                    conn.execute(text(f'ALTER TABLE "{table.name}" ALTER COLUMN "{col.name}" DROP NOT NULL'))
                applied.append(f"{table.name}.{col.name}:nullable")
    return applied


def _upgrade_class_source(engine: Engine) -> list[str]:
    """
    Q-15: ``sku_classifications.class_source`` must never claim ground truth it has not verified.

    * Column missing (table of an old version): added with DEFAULT 'legacy_unverified', so every existing row is
      labelled ``legacy_unverified`` (its source was never recorded).
    * Column present with the OLD default 'ground_truth' (created or upgraded by a previous version, which labelled
      every legacy / unspecified row ``ground_truth`` without checking): every ``ground_truth`` row is verified
      once against the C3-OUT mapping ``c3ok_sku_class.csv``: a row whose segment differs from the mapping (or
      whose SKU / store is not in it) is relabelled ``legacy_unverified``; matching rows keep ``ground_truth``.
      Then the default becomes 'legacy_unverified'. When the mapping file is NOT installed on this machine
      nothing changes (R5B-04) and the step runs again on a machine that has it.
    Nothing is deleted; the next recompute of the store writes the real source again.
    """
    applied: list[str] = []
    insp = inspect(engine)
    cols = {c["name"]: c for c in insp.get_columns("sku_classifications")}
    if "class_source" not in cols:
        with engine.begin() as conn:
            conn.execute(text(
                "ALTER TABLE sku_classifications ADD COLUMN class_source VARCHAR(20) NOT NULL "
                "DEFAULT 'legacy_unverified'"
            ))
        applied.append("sku_classifications.class_source (legacy rows = legacy_unverified)")
        return applied
    default = str(cols["class_source"].get("default") or "")
    if "ground_truth" not in default:
        return applied
    from sqlalchemy.orm import Session
    from app.services.classification_service import classification_service
    with Session(bind=engine) as db:
        n = classification_service.verify_ground_truth_labels(db)
    if n is None:
        # R5B-04: c3ok_sku_class.csv is not installed here. Nothing is relabelled and the old default is kept as
        # the marker, so the verification runs on the next start of a machine that has the mapping file.
        applied.append("sku_classifications ground_truth verification deferred (c3ok_sku_class.csv not installed)")
        return applied
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE sku_classifications ALTER COLUMN class_source SET DEFAULT 'legacy_unverified'"))
    applied.append("sku_classifications.class_source default legacy_unverified")
    applied.append(f"sku_classifications ground_truth verified ({n} relabelled legacy_unverified)")
    return applied


def apply_schema_upgrades(engine: Engine) -> list[str]:
    """Trả về danh sách bước đã áp dụng (rỗng nếu schema đã mới)."""
    applied: list[str] = []
    if engine.dialect.name != "postgresql":
        return applied
    # Bảng mới của phiên bản code này (vd sim_snapshot, sim_shadow_daily) chưa có trên DB cũ:
    # create_all chỉ TẠO bảng còn thiếu, không sửa/xóa bảng đã có.
    from app.models import Base
    before = set(inspect(engine).get_table_names())
    Base.metadata.create_all(engine)
    insp = inspect(engine)
    applied.extend(f"create_table.{t}" for t in sorted(set(insp.get_table_names()) - before))
    applied.extend(_reconcile_columns(engine, Base))
    insp = inspect(engine)
    if "policy_selection" in insp.get_table_names():
        if "source" not in {c["name"] for c in insp.get_columns("policy_selection")}:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE policy_selection ADD COLUMN source VARCHAR(30)"))
            applied.append("policy_selection.source")
    if "replenishment_recommendations" in insp.get_table_names():
        rr_cols = {c["name"] for c in insp.get_columns("replenishment_recommendations")}
        for col in ("on_hand_at_review", "on_order_at_review"):
            if col not in rr_cols:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE replenishment_recommendations ADD COLUMN {col} DOUBLE PRECISION"))
                applied.append(f"replenishment_recommendations.{col}")
    if "audit_logs" in insp.get_table_names():
        # Round 5: a REAL outcome column. Rows written before it existed never recorded their outcome:
        # they are labelled "unknown" (never derived from the action text).
        with engine.begin() as conn:
            n = conn.execute(text("UPDATE audit_logs SET result = 'unknown' WHERE result IS NULL")).rowcount
        if n:
            applied.append(f"audit_logs.result backfill unknown ({n})")
    if "sku_classifications" not in insp.get_table_names():
        return applied

    applied.extend(_upgrade_class_source(engine))
    insp = inspect(engine)
    cols = {c["name"] for c in insp.get_columns("sku_classifications")}
    uniques = {u["name"] for u in insp.get_unique_constraints("sku_classifications")}
    indexes = {i["name"]: i for i in insp.get_indexes("sku_classifications")}

    with engine.begin() as conn:
        # P-10: phân lớp theo (item_id, store_id)
        if "store_id" not in cols:
            conn.execute(text(
                "ALTER TABLE sku_classifications ADD COLUMN store_id VARCHAR NOT NULL DEFAULT 'CA_1'"
            ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_sku_classifications_store_id ON sku_classifications (store_id)"
            ))
            applied.append("sku_classifications.store_id")
        if "threshold_segment" not in cols:
            conn.execute(text("ALTER TABLE sku_classifications ADD COLUMN threshold_segment VARCHAR(2)"))
            applied.append("sku_classifications.threshold_segment")

        # Bỏ ràng buộc unique cũ trên riêng item_id (chặn nhiều kho)
        old_index = indexes.get("ix_sku_classifications_item_id")
        if old_index and old_index.get("unique"):
            conn.execute(text("DROP INDEX IF EXISTS ix_sku_classifications_item_id"))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_sku_classifications_item_id ON sku_classifications (item_id)"
            ))
            applied.append("drop unique(item_id)")
        if "sku_classifications_item_id_key" in uniques:
            conn.execute(text(
                "ALTER TABLE sku_classifications DROP CONSTRAINT IF EXISTS sku_classifications_item_id_key"
            ))
            applied.append("drop constraint item_id_key")
        if "uq_sku_classifications_item_store" not in uniques:
            conn.execute(text(
                "ALTER TABLE sku_classifications "
                "ADD CONSTRAINT uq_sku_classifications_item_store UNIQUE (item_id, store_id)"
            ))
            applied.append("unique(item_id, store_id)")
    return applied
