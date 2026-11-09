import sys
import os
from datetime import datetime, date, timezone, timedelta

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.database import engine, SessionLocal
from app.models.sim_clock import SimClock
from app.models.policy_selection import PolicySelection
from app.models.calibration_state import CalibrationState
from app.models.service_outcomes import ServiceOutcome
from app.models.product import Product
from app.models.classification import SKUClassification
from app.services.optimization_service import optimization_service

STORE_ID = "CA_1"
START_DATE = date(2015, 5, 24)
ALL_CLASSES = ["AX", "AY", "AZ", "BX", "BY", "BZ", "CX", "CY", "CZ"]


def seed_demo_environment():
    """
    Task TEST.2 - Khởi tạo môi trường Demo chuẩn bị cho buổi bảo vệ đồ án tốt nghiệp Capstone:
    1. Thiết lập đồng hồ ảo sim_clock tại ngày xuất phát 2015-05-24 (d_1577 - đầu năm test).
    2. Nạp chính sách tối ưu REFIT-RSS-EOQ-G (Bảng 17) vào policy_selection.
    3. Nạp trạng thái C³-OUT ban đầu (theta = 0.0) vào calibration_state.
    4. Nạp service_outcomes chu kỳ 0 làm mẫu nền tảng.
    """
    db: Session = SessionLocal()
    now = datetime.now(timezone.utc)
    print(f"[*] Bắt đầu thiết lập môi trường Demo cho kho {STORE_ID}...")

    try:
        # 1. Thiết lập sim_clock
        clock = db.query(SimClock).filter(SimClock.store_id == STORE_ID).first()
        if clock:
            clock.current_date = START_DATE
            clock.start_date = START_DATE
            clock.mode = "replay"
            clock.speed = 1.0
            clock.updated_at = now
        else:
            clock = SimClock(
                store_id=STORE_ID,
                current_date=START_DATE,
                start_date=START_DATE,
                mode="replay",
                speed=1.0,
                updated_at=now,
            )
            db.add(clock)
        print(f"  [+] sim_clock: Khởi tạo ngày {START_DATE} (chế độ replay)")

        # 2. Nạp policy_selection cho 9 nhóm
        selection_id = "quarter_2015_Q2"
        for class_id in ALL_CLASSES:
            pol_spec = optimization_service.DEFAULT_OPTIMAL_POLICIES.get(
                class_id, {"m_g": 0.15, "kappa_g": 1.0, "val_cost": 10000.0, "val_service": 0.965}
            )
            existing_pol = (
                db.query(PolicySelection)
                .filter(PolicySelection.selection_id == selection_id, PolicySelection.class_id == class_id)
                .first()
            )
            if existing_pol:
                existing_pol.m_g = pol_spec["m_g"]
                existing_pol.kappa_g = pol_spec["kappa_g"]
                existing_pol.val_cost = pol_spec["val_cost"]
                existing_pol.val_service = pol_spec["val_service"]
            else:
                db.add(
                    PolicySelection(
                        selection_id=selection_id,
                        class_id=class_id,
                        policy_type="REFIT_RSS_EOQ_G",
                        m_g=pol_spec["m_g"],
                        kappa_g=pol_spec["kappa_g"],
                        tau=0.95,
                        setpoint=0.96,
                        guard=0.01,
                        gain_eta=1.0,
                        val_cost=pol_spec["val_cost"],
                        val_service=pol_spec["val_service"],
                        is_feasible=True,
                        econ_service=0.95,
                        created_at=now,
                    )
                )
        print(f"  [+] policy_selection: Nạp thành công tham số tối ưu Bảng 17 cho 9 nhóm ({selection_id})")

        # 3. Nạp calibration_state tại review 0
        for class_id in ALL_CLASSES:
            rec_id = f"{STORE_ID}_{class_id}_rev_0"
            existing_cal = db.query(CalibrationState).filter(CalibrationState.id == rec_id).first()
            if existing_cal:
                existing_cal.theta = 0.0
                existing_cal.multiplier = 1.0
                existing_cal.error_rate = 0.04
                existing_cal.at_boundary = False
                existing_cal.review_date = START_DATE
            else:
                db.add(
                    CalibrationState(
                        id=rec_id,
                        calibrator_id=f"c3out_main_{STORE_ID}",
                        store_id=STORE_ID,
                        class_id=class_id,
                        review_index=0,
                        review_date=START_DATE,
                        theta=0.0,
                        multiplier=1.0,
                        error_rate=0.04,
                        at_boundary=False,
                        setpoint=0.96,
                        eta=1.0,
                        created_at=now,
                    )
                )
        print("  [+] calibration_state: Nạp trạng thái ban đầu theta=0.0 cho 9 nhóm tại review 0")

        # 4. Nạp service_outcomes chu kỳ 0
        cycle_start = START_DATE - timedelta(days=7)
        for class_id in ALL_CLASSES:
            rec_id = f"{STORE_ID}_{class_id}_cycle_0"
            existing_out = db.query(ServiceOutcome).filter(ServiceOutcome.id == rec_id).first()
            if not existing_out:
                db.add(
                    ServiceOutcome(
                        id=rec_id,
                        calibrator_id=f"c3out_main_{STORE_ID}",
                        store_id=STORE_ID,
                        class_id=class_id,
                        cycle_index=0,
                        cycle_start=cycle_start,
                        cycle_end=START_DATE,
                        n_sku=100,
                        n_stockout=4,
                        error_rate=0.04,
                        consumed_at_review=1,
                        created_at=now,
                    )
                )
        print("  [+] service_outcomes: Nạp kết quả nền tảng chu kỳ 0 (error_rate=0.04)")

        db.commit()
        print("\n[V] MÔI TRƯỜNG DEMO ĐÃ SẴN SÀNG CHO BUỔI BẢO VỆ 20 PHÚT TRƯỚC HỘI ĐỒNG!")

    except Exception as e:
        db.rollback()
        print(f"[X] Lỗi khi nạp dữ liệu demo: {e}")
        raise e
    finally:
        db.close()


if __name__ == "__main__":
    seed_demo_environment()
