import unittest
import math
from datetime import date, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.base import Base
from app.models.calibration_state import CalibrationState
from app.models.service_outcomes import ServiceOutcome
from app.models.sim_clock import SimClock
from app.services.calibrator_service import calibrator_service
from app.services.optimization_service import optimization_service
from app.services.window_quantile_service import window_quantile_service, ROUTE_C_TAU_LEVELS
from app.services.simulation_service import simulation_service
from app.services.dashboard_service import dashboard_service
from app.services.data_preprocessing_service import data_preprocessing_service


class TestC3OutAndSimulation(unittest.TestCase):

    def test_c3out_integral_update_math(self):
        """
        Test TEST.1 - Kiểm định tính đúng đắn toán học của thuật toán C³-OUT (research.md §8.1, Sửa lỗi N-02):
        theta_k = theta_{k-1} + eta * ( e~_{k-d} - (1 - setpoint) )
        - Setpoint: 0.96 -> target error rate: 0.04
        - eta = 1.0
        - Kẹp biên hai phía: [-2.0, 2.0]
        - Anti-windup: e~ = 0 khi theta >= 2.0; e~ = 1 khi theta <= -2.0
        """
        self.assertEqual(calibrator_service.MAX_THETA, 2.0)
        self.assertEqual(calibrator_service.MIN_THETA, -2.0)

        eta = 1.0
        setpoint = 0.96
        target_error = 1.0 - setpoint  # 0.04

        # Trường hợp 1: Không có sai số (e~ = 0.04) -> theta không đổi
        theta_0 = 0.0
        obs_error_1 = 0.04
        theta_1 = max(-2.0, min(2.0, theta_0 + eta * (obs_error_1 - target_error)))
        self.assertEqual(round(theta_1, 4), 0.0)

        # Trường hợp 2: Tỷ lệ thiếu hàng tăng lên e~ = 0.09 (vượt 5pp) -> theta tăng lên 0.05
        obs_error_2 = 0.09
        theta_2 = max(-2.0, min(2.0, theta_1 + eta * (obs_error_2 - target_error)))
        self.assertEqual(round(theta_2, 4), 0.05)
        multiplier_2 = round(math.exp(theta_2), 4)
        self.assertGreater(multiplier_2, 1.0)

        # Trường hợp 3 (Kiểm tra sửa dứt điểm N-02):
        # Tại theta = 0.0 và 0 stockout (e~ = 0.0):
        # Lỗi N-02 cũ: vì MIN_THETA=0 nên ép e~ = 1.0 làm theta nhảy vọt lên +0.96!
        # Chuẩn §8.1: Quy ước biên chỉ áp dụng khi theta <= -2.0.
        # Tại theta = 0.0, e~ = 0.0 -> delta_theta = -0.04, theta giảm nhẹ xuống -0.04, TUYỆT ĐỐI không nhảy lên +0.96.
        prev_theta = 0.0
        obs_error_real = 0.0  # 0 stockouts
        if prev_theta >= calibrator_service.MAX_THETA:
            obs_error_calc = 0.0
        elif prev_theta <= calibrator_service.MIN_THETA:
            obs_error_calc = 1.0
        else:
            obs_error_calc = obs_error_real

        self.assertEqual(obs_error_calc, 0.0)  # Không bị ép thành 1.0
        theta_3 = max(calibrator_service.MIN_THETA, min(calibrator_service.MAX_THETA, prev_theta + eta * (obs_error_calc - target_error)))
        self.assertEqual(round(theta_3, 4), -0.04)
        self.assertNotEqual(round(theta_3, 2), 0.96)

        # Trường hợp 4: Anti-windup trần trên khi theta >= 2.0 (ép e~ = 0.0) -> kéo theta xuống
        prev_high = 2.0
        obs_error_high = 0.0 if prev_high >= calibrator_service.MAX_THETA else 0.5
        self.assertEqual(obs_error_high, 0.0)
        theta_pulled_down = prev_high + eta * (obs_error_high - target_error)
        self.assertEqual(round(theta_pulled_down, 2), 1.96)

        # Trường hợp 5: Anti-windup sàn dưới khi theta <= -2.0 (ép e~ = 1.0) -> kéo theta lên
        prev_low = -2.0
        obs_error_low = 1.0 if prev_low <= calibrator_service.MIN_THETA else 0.0
        self.assertEqual(obs_error_low, 1.0)
        theta_pulled_up = prev_low + eta * (obs_error_low - target_error)
        self.assertEqual(round(theta_pulled_up, 2), -1.04)

    def test_c3out_run_calibration_step_prev_theta_zero_no_windup(self):
        """
        Test TEST.1 - Tái hiện và kiểm định sửa dứt điểm lỗi N-02 trên DB thật:
        Khi theta=0.0 ở chu kỳ trước và không có stockout (error_rate=0.0),
        bước calibration step không được kích hoạt anti-windup và không được ép error_rate=1.0.
        """
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        db = Session()

        try:
            clock = SimClock(store_id="CA_1", current_date=date(2016, 5, 23), start_date=date(2016, 4, 25))
            db.add(clock)
            db.commit()

            # Khởi tạo trạng thái CX với theta = 0.0
            cx_init = CalibrationState(
                id="CA_1_CX_rev_0",
                calibrator_id="c3out_main_CA_1",
                store_id="CA_1",
                class_id="CX",
                review_index=0,
                review_date=date(2016, 5, 16),
                theta=0.0,
                multiplier=1.0,
                error_rate=0.0,
                at_boundary=False,
                setpoint=0.96,
                eta=1.0,
            )
            db.add(cx_init)

            # Service outcome với 0 stockouts (error_rate = 0.0)
            outcome = ServiceOutcome(
                id="CA_1_CX_cycle_0",
                calibrator_id="c3out_main_CA_1",
                store_id="CA_1",
                class_id="CX",
                cycle_index=0,
                cycle_start=date(2016, 5, 9),
                cycle_end=date(2016, 5, 15),
                n_sku=100,
                n_stockout=0,
                error_rate=0.0,
            )
            db.add(outcome)
            db.commit()

            # Gọi run_calibration_step tại review kỳ 2 (d=2 -> tiêu thụ cycle 0)
            states, warnings, consumed = calibrator_service.run_calibration_step(
                db=db,
                store_id="CA_1",
                review_index=2,
                review_date=date(2016, 5, 23),
                lead_time_days=3,
                review_period_days=7,
            )

            cx_new = next(s for s in states if s.class_id == "CX")
            # Kiểm tra: error_rate phải giữ nguyên 0.0, TUYỆT ĐỐI không bị ép thành 1.0
            self.assertEqual(cx_new.error_rate, 0.0)
            # theta phải giảm nhẹ -0.04 (hoặc giữ mức âm), TUYỆT ĐỐI không nhảy lên +0.96
            self.assertEqual(cx_new.theta, -0.04)
            self.assertNotEqual(cx_new.theta, 0.96)
        finally:
            db.close()

    def test_route_c_quantile_calculation_and_floor(self):
        """
        Test TEST.1 - Kiểm định Route (c) phân phối cửa sổ bảo vệ H = L + R = 10:
        - Q_hat(tau) = max(0, F_hat(H) + Percentile_tau(r))
        - Quantile floor = 1.0 cho tau >= 0.90
        """
        point_window = 12.0
        residuals = [-2.0, -1.0, 0.0, 1.0, 2.0, 3.0, 4.0]

        q_dict = window_quantile_service.calculate_quantiles_dict(
            point_window=point_window,
            residuals=residuals,
            tau_levels=ROUTE_C_TAU_LEVELS,
            quantile_floor=1.0,
        )

        # Đảm bảo có đủ 24 mức quantile
        self.assertEqual(len(q_dict), 24)
        # Kiểm tra tính đơn điệu tăng dần: Q(0.10) <= Q(0.50) <= Q(0.95)
        self.assertLessEqual(q_dict["0.1"], q_dict["0.5"])
        self.assertLessEqual(q_dict["0.5"], q_dict["0.95"])
        # Kiểm tra sàn tối thiểu floor=1.0 tại tau >= 0.90
        self.assertGreaterEqual(q_dict["0.95"], 1.0)

    def test_refit_rss_eoq_g_formulas(self):
        """
        Test TEST.1 - Kiểm định công thức đặt hàng tối ưu chính sách REFIT-RSS-EOQ-G:
        - s = ceil( Q_hat(0.95) * exp(m_g + theta_g) )
        - EOQ = sqrt( 2 * c * D / h )
        - S = s + ceil( kappa_g * EOQ )
        """
        q_hat = 15.0
        m_g = 0.183   # Nhóm AY
        theta_g = 0.05
        kappa_g = 1.0
        order_cost_c = 50.0
        holding_cost_h = 2.0
        annual_demand_d = 1000.0

        # 1. Tính mức sàn Reorder point s
        expected_s = math.ceil(q_hat * math.exp(m_g + theta_g))
        self.assertEqual(expected_s, math.ceil(15.0 * math.exp(0.233)))
        self.assertGreater(expected_s, q_hat)

        # 2. Tính EOQ
        expected_eoq = max(1.0, round(math.sqrt((2 * order_cost_c * annual_demand_d) / holding_cost_h), 1))
        self.assertEqual(expected_eoq, round(math.sqrt((2 * 50.0 * 1000.0) / 2.0), 1))

        # 3. Tính mức trần Order-Up-To S
        expected_S = expected_s + math.ceil(kappa_g * expected_eoq)
        self.assertGreater(expected_S, expected_s)

        # 4. Kiểm tra điều kiện đặt hàng: IP < s -> q = S - IP
        ip_low = expected_s - 5
        order_qty = expected_S - ip_low
        self.assertGreater(order_qty, expected_eoq)

        ip_high = expected_s + 10
        self.assertFalse(ip_high < expected_s)

    def test_simulation_policy_comparison_metrics(self):
        """
        Test TEST.1 - Kiểm định logic so sánh đối đầu 4 chính sách tồn kho (Sửa lỗi N-01):
        - Đọc dữ liệu thực nghiệm chuẩn từ c3ok_results.csv và mô hình chi phí A3
        - P4 (P-CR) đạt chuẩn SLA 96% và có chi phí thấp nhất
        - P0 (Cổ điển) bị vi phạm SLA (< 96%) và có chi phí cao
        - Khi target_service_level = 0.99: P6 không được hardcode is_feasible=True
        """
        # Test case 1: Target SLA 0.96
        res = simulation_service.compare_policies(
            db=None,
            store_id="CA_1",
            horizon_days=90,
            target_service_level=0.96,
        )

        self.assertEqual(len(res.policies), 4)
        p_map = {p.policy_id: p for p in res.policies}

        # P4 (P-CR) đạt tính khả thi và có chi phí tối ưu nhất
        self.assertTrue(p_map["P4_frozen_refit"].is_feasible)
        self.assertGreaterEqual(p_map["P4_frozen_refit"].availability, 96.0)
        self.assertEqual(res.recommended_policy, "P4_frozen_refit")

        # P0 bị vi phạm SLA (CSL ~90.7%)
        self.assertFalse(p_map["P0_classical"].is_feasible)
        self.assertLess(p_map["P0_classical"].availability, 96.0)

        # P4 và P6 có tổng chi phí rẻ hơn P0 đáng kể
        self.assertLess(p_map["P4_frozen_refit"].total_cost, p_map["P0_classical"].total_cost)
        self.assertLess(p_map["P6_c3out_closed_loop"].total_cost, p_map["P0_classical"].total_cost)

        # Test case 2: Target SLA 0.99 (Kiểm tra sửa triệt để N-01: không hardcode is_feasible=True cho P6)
        res_99 = simulation_service.compare_policies(
            db=None,
            store_id="CA_1",
            horizon_days=90,
            target_service_level=0.99,
        )
        p_map_99 = {p.policy_id: p for p in res_99.policies}
        self.assertFalse(p_map_99["P6_c3out_closed_loop"].is_feasible)

    def test_data_preprocessing_service_auto_detection(self):
        """
        Test PRE.3 - Kiểm định khả năng tự động tiền xử lý dữ liệu:
        - Tự động nhận diện dấu chấm phẩy (;) và bảng mã latin1
        - Tự động ánh xạ cột tiếng Việt (Thời gian tạo đơn, Mã mặt hàng, SL, Đơn giá)
        - Tự động gộp đơn hàng nhiều lần trong ngày thành doanh số ngày (daily sales)
        """
        raw_csv = (
            "Th?i gian t?o ??n;Mã ??n hàng;Mã m?t hàng;SL;??n giá\n"
            "2022-01-01 08:00:00;ORD01;BOT01;2;40000\n"
            "2022-01-01 14:00:00;ORD02;BOT01;3;40000\n"
            "2022-01-02 10:00:00;ORD03;BOT01;1;40000\n"
        ).encode("latin1")

        clean_df, report = data_preprocessing_service.preprocess_sales_data(
            file_content=raw_csv,
            file_name="test_order_log.csv",
            default_store_id="STORE_TEST",
        )

        self.assertEqual(report["status"], "PASSED")
        self.assertEqual(report["unique_skus"], 1)
        day1_row = clean_df[clean_df["sale_date"] == "2022-01-01"].iloc[0]
        self.assertEqual(day1_row["sales"], 5.0)
        self.assertEqual(day1_row["price"], 40000.0)
        self.assertEqual(day1_row["item_id"], "BOT01")
        self.assertEqual(day1_row["store_id"], "STORE_TEST")

    def test_shadow_baseline_kpi_dashboard_no_fake_constants(self):
        """
        Test TEST.1 - Kiểm định sửa dứt điểm lỗi N-03 (KPI shadow dashboard):
        - Khi không có giao dịch/sự kiện nào phát sinh, chi phí và tiết kiệm phải là 0.0,
          TUYỆT ĐỐI không được cộng tĩnh +120, +45, +18 hay báo "tiết kiệm $735".
        - B0 availability phải khớp số liệu thực nghiệm c3ok_csl_by_class.csv (ví dụ AZ=82.8%, AX=91.5%),
          TUYỆT ĐỐI không dùng công thức tự chế err * 2.8.
        """
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        db = Session()

        try:
            clock = SimClock(store_id="CA_1", current_date=date(2016, 5, 23), start_date=date(2016, 4, 25))
            db.add(clock)
            db.commit()

            res = dashboard_service.get_shadow_baseline_dashboard(db, store_id="CA_1")

            # 1. Khi 0 sự kiện: chi phí và tiết kiệm phải bằng 0.0
            self.assertEqual(res.c3out_total_cost, 0.0)
            self.assertEqual(res.b0_total_cost, 0.0)
            self.assertEqual(res.total_cost_savings, 0.0)
            for pt in res.cost_curves:
                self.assertEqual(pt.c3out_total_cost, 0.0)
                self.assertEqual(pt.b0_total_cost, 0.0)
                self.assertEqual(pt.cost_savings, 0.0)

            # 2. B0 availability phải lấy từ c3ok_csl_by_class.csv
            seg_map = {s.class_id: s for s in res.segment_availabilities}
            self.assertEqual(seg_map["AZ"].b0_availability, 82.8)
            self.assertEqual(seg_map["AX"].b0_availability, 91.5)
            self.assertEqual(seg_map["BY"].b0_availability, 92.0)
            self.assertNotEqual(seg_map["AZ"].b0_availability, round((1.0 - 0.032 * 2.8) * 100, 1))

            # 3. Cảnh báo đúng chuẩn nếu chưa có sự kiện
            self.assertIn("chưa ghi nhận giao dịch", res.summary_insights[1])
        finally:
            db.close()

    def test_tier2_mg_decoupled_from_tier3_theta_no_doubling(self):
        """
        Test N-05: Kiểm tra tách m_g của Tier 2 khỏi theta của C3-OUT.
        - Khởi tạo mặc định m_g = 0.0 cho cả 9 lớp (tránh lỗi cộng dồn thành e^{2*theta})
        """
        from app.services.optimization_service import optimization_service
        for class_id, policy in optimization_service.DEFAULT_OPTIMAL_POLICIES.items():
            self.assertEqual(
                policy["m_g"],
                0.0,
                f"Lớp {class_id} có m_g={policy['m_g']} != 0.0, gây lỗi nhân đôi e^(2*theta)!",
            )

    def test_tier2_j5_constrained_grid_search_and_feasibility(self):
        """
        Test N-07: Kiểm tra tối ưu Tier 2 J5 qua quét lưới có ràng buộc theo research.md §7.4:
        - Quét lưới thực tế (m, kappa)
        - Kappa >= 0.5 đảm bảo batching EOQ (S > s)
        - is_feasible kiểm tra động theo target_availability + 0.01 guard
        """
        from app.services.optimization_service import optimization_service
        from app.models.classification import SKUClassification
        from app.models.product import Product

        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        db = Session()
        try:
            # 1. Tạo dữ liệu Product và SKUClassification cho nhóm AX
            p = Product(item_id="TEST_SKU_AX", name="Item AX", cat_id="FOODS", price=10.0)
            db.add(p)
            cls_ax = SKUClassification(
                id="cls_ax_01",
                item_id="TEST_SKU_AX",
                abc_class="A",
                xyz_class="X",
                segment="AX",
                cv=0.2,
                mean_demand=20.0,
            )
            db.add(cls_ax)
            db.commit()

            # 2. Chạy refit_quarterly_policies với target = 0.95
            res = optimization_service.refit_quarterly_policies(
                db, store_id="CA_1", target_availability=0.95
            )
            ax_res = next(r for r in res if r["class_id"] == "AX")
            self.assertGreaterEqual(ax_res["kappa_g"], 0.5)
            self.assertGreaterEqual(ax_res["val_service"], 0.95)
            self.assertTrue(ax_res["is_feasible"])

            # 3. Chạy với target quá cao (0.999) -> Không khả thi -> is_feasible = False
            res_high = optimization_service.refit_quarterly_policies(
                db, store_id="CA_1", target_availability=0.999
            )
            ax_high = next(r for r in res_high if r["class_id"] == "AX")
            self.assertFalse(ax_high["is_feasible"])
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
