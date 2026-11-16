"""
Demo environment (Task TEST.2).

ONE date convention (P-35 / N-11): policy_config.DEMO_START_DATE for the simulated clock, the quantile
origin (load_forecast_window_quantile), the calibration state and the policy selection id. The previous
version used 2015-05-24 here, 2016-04-25 in sync and 2016-05-23 for the quantile origin.

This script only fills what is MISSING and never overwrites results measured elsewhere:
  * sim_clock reset to the demo start date (replay mode);
  * policy_selection (neutral policy m_g = 0, kappa = 1, setpoint = target availability) if the
    demo selection does not exist;
  * calibration_state rev_0 (theta = 0) only if the store has no state at all (the theta trajectory is kept);
  * no invented service_outcomes: C3-OUT starts from a neutral error until the simulator produces real ones.
"""
import os
import sys
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

from sqlalchemy.orm import Session
from app.core.database import SessionLocal
from app.models.sim_clock import SimClock
from app.models.policy_selection import PolicySelection
from app.models.calibration_state import CalibrationState
from app.services import policy_config as pc
from app.services.optimization_service import optimization_service

STORE_ID = pc.DEMO_STORE_ID
START_DATE = pc.DEMO_START_DATE
ALL_CLASSES = pc.ALL_CLASSES


def seed_demo_environment():
    db: Session = SessionLocal()
    now = datetime.now(timezone.utc)
    print(f"[*] Seeding demo environment for {STORE_ID} (start {START_DATE})...")
    try:
        clock = db.query(SimClock).filter(SimClock.store_id == STORE_ID).first()
        if clock:
            clock.current_date, clock.start_date = START_DATE, START_DATE
            clock.mode, clock.speed, clock.updated_at = "replay", 1.0, now
        else:
            db.add(SimClock(store_id=STORE_ID, current_date=START_DATE, start_date=START_DATE,
                            mode="replay", speed=1.0, updated_at=now))
        print(f"  [+] sim_clock = {START_DATE} (replay)")

        selection_id = pc.DEMO_SELECTION_ID
        for class_id in ALL_CLASSES:
            spec = optimization_service.DEFAULT_OPTIMAL_POLICIES[class_id]
            if db.query(PolicySelection).filter(PolicySelection.selection_id == selection_id,
                                                PolicySelection.class_id == class_id).first():
                continue
            db.add(PolicySelection(
                selection_id=selection_id, class_id=class_id, policy_type="REFIT_RSS_EOQ_G",
                m_g=spec["m_g"], kappa_g=spec["kappa_g"], tau=pc.TARGET_AVAILABILITY,
                setpoint=pc.TARGET_AVAILABILITY, guard=pc.GUARD, gain_eta=pc.CONTROLLER_ETA,
                val_cost=spec["val_cost"], val_service=spec["val_service"], is_feasible=True,
                econ_service=pc.TARGET_AVAILABILITY, created_at=now,
            ))
        print(f"  [+] policy_selection {selection_id} present for 9 classes (m_g = 0, kappa = 1, setpoint {pc.TARGET_AVAILABILITY})")

        if db.query(CalibrationState).filter(CalibrationState.store_id == STORE_ID).count() == 0:
            for class_id in ALL_CLASSES:
                db.add(CalibrationState(
                    id=f"{STORE_ID}_{class_id}_rev_0", calibrator_id=f"c3out_main_{STORE_ID}", store_id=STORE_ID,
                    class_id=class_id, review_index=0, review_date=START_DATE, theta=0.0, multiplier=1.0,
                    error_rate=None, at_boundary=False, setpoint=pc.TARGET_AVAILABILITY,
                    eta=pc.CONTROLLER_ETA, created_at=now,
                ))
            print("  [+] calibration_state: neutral rev_0 (theta = 0)")
        else:
            print("  [=] calibration_state already present: theta trajectory kept")
        db.commit()
        print("\n[V] Demo environment ready.")
    except Exception as e:
        db.rollback()
        print(f"[X] Error while seeding demo data: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_demo_environment()
