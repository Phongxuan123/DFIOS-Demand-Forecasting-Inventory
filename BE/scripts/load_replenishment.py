import sys
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

from sqlalchemy import text
from app.core.database import engine, SessionLocal
from app.services.policy_config import DEMO_START_DATE

STORE_ID = "CA_1"

# P-12: proposals are dated with the SIMULATED clock of the store (never wall-clock "today"/NULL), so they sit in
# the same time axis as the simulator. They stay PENDING proposals: the simulator only receives APPROVED orders,
# and in auto-order mode PENDING rows never block reordering (replenishment_service.generate_recommendations).
# Round 5: the proposals are produced by the app's own (R, s, S) rule (replenishment_service), from the current
# inventory and inventory_params, with the IP split at the review date stored. The last bootstrap step
# (sync_scientific_baseline, step 9) rebuilds them once more from the FINAL baseline state (stock = S).
with engine.begin() as _conn:
    _row = _conn.execute(text('SELECT "current_date" FROM sim_clock WHERE store_id = :s'), {"s": STORE_ID}).first()
REVIEW_DATE = _row[0] if _row else DEMO_START_DATE

with engine.begin() as conn:
    conn.execute(text("""
        ALTER TABLE replenishment_recommendations
            ADD COLUMN IF NOT EXISTS "order_up_to_S" DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS reorder_point_s DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS inventory_position DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS eoq_quantity DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS policy_applied VARCHAR(50) DEFAULT 'REFIT-RSS-EOQ-G',
            ADD COLUMN IF NOT EXISTS review_date DATE,
            ADD COLUMN IF NOT EXISTS on_hand_at_review DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS on_order_at_review DOUBLE PRECISION;
    """))

from app.services.replenishment_service import replenishment_service  # noqa: E402

db = SessionLocal()
try:
    res = replenishment_service.regenerate_pending_proposals(db, STORE_ID, REVIEW_DATE)
finally:
    db.close()
print(f"Pending replenishment proposals at {REVIEW_DATE}: {res['created']} (replaced {res['removed']}).")
