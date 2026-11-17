"""P0 backend regressions: X-01 (no hardcoded BY ground truth) and X-02 (per-store J6 class join)."""
import os
import sys
from datetime import date, datetime, timezone

import pandas as pd
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.base import Base
from app.models.classification import SKUClassification
from app.models.inventory import Inventory
from app.models.product import Product
from app.schemas.classification import ClassificationThresholds
from app.services.calibrator_service import calibrator_service

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import load_c3out_data  # noqa: E402


def test_x01_missing_class_uses_thresholds_not_by():
    rows = []
    for i in range(10):
        rows.append({
            "item_id": f"I{i}", "demand_h7": 70.0 - i, "sigma_d_h7": 1.0, "unit_price": 2.0,
            "annual_demand": (70.0 - i) / 7 * 365, "class": "AX" if i < 3 else None,
        })
    merged = pd.DataFrame(rows)
    out = load_c3out_data.build_sku_classes(
        merged, "CA_1", ClassificationThresholds(), datetime.now(timezone.utc)
    )
    by_item = {r["item_id"]: r for r in out}
    assert len(out) == 10
    for i in range(3):
        assert by_item[f"I{i}"]["class_source"] == "ground_truth"
        assert by_item[f"I{i}"]["segment"] == "AX"
    missing = [r for r in out if r["item_id"] not in ("I0", "I1", "I2")]
    assert all(r["class_source"] == "thresholds" for r in missing)
    # not blanket-BY: the ABC part follows cumulative revenue share (tail SKUs fall into C)
    assert any(r["abc_class"] == "C" for r in missing)
    assert not all(r["segment"] == "BY" for r in missing)


def test_x02_j6_classes_not_double_counted_across_stores():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        db.add(Product(item_id="SKU1", name="x", price=1.0))
        for st in ("CA_1", "CA_2"):
            db.add(Inventory(item_id="SKU1", store_id=st, on_hand=5, on_order=0))
            db.add(SKUClassification(
                id=f"SKU1_{st}", item_id="SKU1", store_id=st, abc_class="A", xyz_class="X", segment="AX",
                class_source="thresholds",
            ))
        db.commit()
        outcomes = calibrator_service.record_cycle_outcome(
            db, store_id="CA_1", cycle_start=date(2024, 1, 1), cycle_end=date(2024, 1, 7)
        )
        ax = [o for o in outcomes if o.class_id == "AX"]
        assert len(ax) == 1
        assert ax[0].n_sku == 1
    finally:
        db.close()
