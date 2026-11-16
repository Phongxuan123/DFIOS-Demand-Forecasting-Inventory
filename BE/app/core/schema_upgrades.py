"""
Nâng cấp schema tại chỗ cho DB đã tồn tại (dự án chưa dùng Alembic).

`Base.metadata.create_all()` chỉ tạo bảng còn thiếu, không thêm cột vào bảng cũ. Các bước dưới đây
idempotent, chỉ chạy trên PostgreSQL và được gọi từ `scripts/init_tables.py` / `scripts/bootstrap.py`.
"""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


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
    if "sku_classifications" not in insp.get_table_names():
        return applied

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
        if "class_source" not in cols:
            conn.execute(text(
                "ALTER TABLE sku_classifications ADD COLUMN class_source VARCHAR(20) NOT NULL DEFAULT 'ground_truth'"
            ))
            applied.append("sku_classifications.class_source")
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
