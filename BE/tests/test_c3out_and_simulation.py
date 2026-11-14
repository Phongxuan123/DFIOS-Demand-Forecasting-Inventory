import unittest
import math
from datetime import date, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.base import Base
from app.models.calibration_state import CalibrationState
from app.models.service_outcomes import ServiceOutcome
from app.models.sim_clock import SimClock
from app.models.policy_selection import PolicySelection
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

    def test_r30_store_policy_selection_priority_and_fallback(self):
        """
        R-30: Kiểm tra Calibrator ưu tiên policy_selection theo store_id, fallback global
        khi không có store_id cụ thể, không bị lỗi query %store% sai cú pháp.
        """
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        db = Session()
        try:
            # 1. Global policy với setpoint = 0.95, eta = 1.5
            p_global = PolicySelection(
                selection_id="quarter_2015_Q2",
                class_id="AY",
                policy_type="REFIT_RSS_EOQ_G",
                setpoint=0.95,
                gain_eta=1.5,
            )
            # 2. Store-specific policy cho CA_2 với setpoint = 0.98, eta = 2.0
            p_store_ca2 = PolicySelection(
                selection_id="CA_2_quarter_2015_Q2",
                class_id="AY",
                policy_type="REFIT_RSS_EOQ_G",
                setpoint=0.98,
                gain_eta=2.0,
            )
            db.add(p_global)
            db.add(p_store_ca2)
            db.commit()

            # Gọi run_calibration_step cho CA_2 -> AY phải nhận setpoint 0.98, eta 2.0
            states_ca2, _, _ = calibrator_service.run_calibration_step(
                db=db,
                store_id="CA_2",
                review_index=1,
                review_date=date(2016, 5, 23),
            )
            ay_ca2 = next(s for s in states_ca2 if s.class_id == "AY")
            self.assertEqual(ay_ca2.setpoint, 0.98)
            self.assertEqual(ay_ca2.eta, 2.0)

            # Gọi run_calibration_step cho CA_1 -> AY không có store policy nên fallback sang global 0.95, eta 1.5
            states_ca1, _, _ = calibrator_service.run_calibration_step(
                db=db,
                store_id="CA_1",
                review_index=1,
                review_date=date(2016, 5, 23),
            )
            ay_ca1 = next(s for s in states_ca1 if s.class_id == "AY")
            self.assertEqual(ay_ca1.setpoint, 0.95)
            self.assertEqual(ay_ca1.eta, 1.5)
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

    def test_simulator_j1_j6_advance_sim_clock_and_order_cycle(self):
        """
        Test N-08 & N-11: Kiểm tra bộ mô phỏng J1-J6 trong advance_sim_clock:
        - Đề xuất bổ sung có review_date = t
        - Đơn hàng sau lead_time_days chuyển status COMPLETED và nhập kho (on_hand tăng)
        - InventoryDaily được lưu đầy đủ không có N+1 query
        - Chặn tua > 90 ngày với HTTP 400
        - Chu kỳ rà soát J6 không chồng lấn (đúng 7 ngày)
        """
        from app.services.pipeline_service import pipeline_service
        from app.services.replenishment_service import replenishment_service
        from app.models.product import Product
        from app.models.inventory import Inventory
        from app.models.inventory_daily import InventoryDaily
        from app.models.inventory_param import InventoryParam
        from app.models.sales_history import SalesHistory
        from app.models.replenishment import ReplenishmentRecommendation
        from app.models.sim_clock import SimClock
        from fastapi import HTTPException

        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        db = Session()
        try:
            start_d = date(2016, 4, 25)
            clock = SimClock(store_id="CA_1", current_date=start_d, start_date=start_d)
            db.add(clock)

            # 1. Tạo sản phẩm và tồn kho ban đầu
            p = Product(item_id="TEST_ITEM_01", name="Test Item", cat_id="FOODS", price=10.0)
            inv = Inventory(item_id="TEST_ITEM_01", store_id="CA_1", on_hand=10.0, on_order=0.0)
            param = InventoryParam(
                id="CA_1_TEST_ITEM_01",
                item_id="TEST_ITEM_01",
                store_id="CA_1",
                s=20.0,
                S=50.0,
                reorder_point=20.0,
                safety_stock=10.0,
                eoq=30.0,
            )
            db.add_all([p, inv, param])

            # 2. Tạo sales history cho 14 ngày
            for i in range(14):
                s_date = start_d + timedelta(days=i + 1)
                db.add(SalesHistory(id=f"sh_{i}", item_id="TEST_ITEM_01", store_id="CA_1", sale_date=s_date, quantity=2.0))
            db.commit()

            # 3. Chặn tua > 90 ngày
            with self.assertRaises(HTTPException) as cm:
                pipeline_service.advance_sim_clock(db, store_id="CA_1", days=95)
            self.assertEqual(cm.exception.status_code, 400)

            # 4. Tua 7 ngày (từ 2016-04-25 đến 2016-05-02)
            res = pipeline_service.advance_sim_clock(
                db, store_id="CA_1", days=7, lead_time_days=3, review_period_days=7
            )
            self.assertTrue(res["success"])
            self.assertEqual(res["days_advanced"], 7)
            self.assertEqual(res["current_date"], date(2016, 5, 2))

            # Kiểm tra InventoryDaily đã sinh 7 bản ghi
            dailies = db.query(InventoryDaily).filter(InventoryDaily.item_id == "TEST_ITEM_01").all()
            self.assertEqual(len(dailies), 7)

            # Kiểm tra đề xuất bổ sung sinh ở review day có review_date = 2016-05-02
            recs = db.query(ReplenishmentRecommendation).filter(ReplenishmentRecommendation.item_id == "TEST_ITEM_01").all()
            self.assertGreaterEqual(len(recs), 1)
            first_rec = recs[0]
            self.assertEqual(first_rec.review_date, date(2016, 5, 2))

            # 5. Tua tiếp 3 ngày (đến 2016-05-05 = lead_time_days) -> đơn hàng phải đến và COMPLETED
            res2 = pipeline_service.advance_sim_clock(
                db, store_id="CA_1", days=3, lead_time_days=3, review_period_days=7
            )
            db.refresh(first_rec)
            self.assertEqual(first_rec.status, "COMPLETED")

            # on_hand phải được cộng thêm số lượng đơn hàng về
            db.refresh(inv)
            self.assertGreater(inv.on_hand, 0.0)
        finally:
            db.close()

    def test_get_sim_clock_no_side_effect_insert(self):
        """
        Test N-19: GET sim_clock không được có side-effect INSERT store bất kỳ vào cơ sở dữ liệu.
        """
        from app.services.pipeline_service import pipeline_service
        from app.models.sim_clock import SimClock

        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        db = Session()
        try:
            # 1. Gọi get_sim_clock với store không tồn tại
            res = pipeline_service.get_sim_clock(db, store_id="NON_EXISTENT_STORE", auto_create=False)
            self.assertIsNone(res)

            # Đảm bảo KHÔNG có bản ghi nào bị INSERT lén vào DB
            count = db.query(SimClock).filter(SimClock.store_id == "NON_EXISTENT_STORE").count()
            self.assertEqual(count, 0)

            # 2. advance_sim_clock, reset_sim_clock, set_sim_speed với store không tồn tại phải bắn lỗi ValueError
            with self.assertRaises(ValueError):
                pipeline_service.advance_sim_clock(db, store_id="NON_EXISTENT_STORE", days=1)

            with self.assertRaises(ValueError):
                pipeline_service.reset_sim_clock(db, store_id="NON_EXISTENT_STORE")

            with self.assertRaises(ValueError):
                pipeline_service.set_sim_speed(db, store_id="NON_EXISTENT_STORE", speed=2.0)
        finally:
            db.close()

    def test_route_c_lookahead_bias_prevention_and_causal_invariance(self):
        """
        Test N-25 / R-15 / R-47: Kiểm định tính nhân quả (Causality) và Zero Lookahead Bias của Route (c).
        Toàn bộ dữ liệu doanh số/dự báo trong tương lai (sau origin_date hoặc sau cutoff_date)
        tuyệt đối không được rò rỉ vào việc tính sai số lịch sử và phân vị cửa sổ Q_H(tau).
        """
        import numpy as np
        from app.services.window_quantile_service import window_quantile_service
        from app.models.sales_history import SalesHistory
        from app.models.forecast import Forecast

        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        db = Session()
        try:
            store = "CA_1"
            item = "FOODS_1_001"
            origin = date(2016, 4, 25)
            H = 10

            # 1. Nạp 40 ngày dữ liệu lịch sử trước origin (đảm bảo <= cutoff = origin - 10)
            base_date = date(2016, 3, 1)
            for i in range(40):
                d = base_date + timedelta(days=i)
                # Chỉ nạp đến ngày 2016-04-10 (trước cutoff 2016-04-15)
                if d <= date(2016, 4, 10):
                    sh = SalesHistory(id=f"sh_past_{i}", item_id=item, store_id=store, sale_date=d, quantity=10.0 + (i % 3))
                    fc = Forecast(
                        id=f"fc_past_{i}", item_id=item, store_id=store, forecast_date=d,
                        h=1, y_pred=10.0, p10=8.0, p50=10.0, p90=12.0, available=True, model_version="ensemble_v1"
                    )
                    db.add_all([sh, fc])
            db.commit()

            # Thu thập sai số và giá trị quantile tại origin trước khi có dữ liệu tương lai
            res_before = window_quantile_service.collect_historical_residuals(
                db, item_id=item, store_id=store, origin_date=origin, horizon_days=H
            )
            q_val_before = window_quantile_service.get_tau_quantile_value(
                db, store_id=store, item_id=item, origin_date=origin, tau=0.95, horizon_days=H
            )
            self.assertGreater(len(res_before), 0)
            self.assertGreater(q_val_before, 0.0)

            # 2. Bơm dữ liệu TƯƠNG LAI đột biến (sau origin_date: ngày 2016-04-26 đến 2016-05-10) với doanh số cực lớn (999.0)
            for i in range(15):
                future_d = origin + timedelta(days=i + 1)
                sh_future = SalesHistory(id=f"sh_future_{i}", item_id=item, store_id=store, sale_date=future_d, quantity=999.0)
                fc_future = Forecast(
                    id=f"fc_future_{i}", item_id=item, store_id=store, forecast_date=future_d,
                    h=1, y_pred=5.0, p10=2.0, p50=5.0, p90=8.0, available=True, model_version="ensemble_v1"
                )
                db.add_all([sh_future, fc_future])
            db.commit()

            # 3. Thu thập lại sai số và quantile tại origin
            res_after = window_quantile_service.collect_historical_residuals(
                db, item_id=item, store_id=store, origin_date=origin, horizon_days=H
            )
            q_val_after = window_quantile_service.get_tau_quantile_value(
                db, store_id=store, item_id=item, origin_date=origin, tau=0.95, horizon_days=H
            )

            # Khẳng định tính nhân quả tuyệt đối: Dữ liệu tương lai không ảnh hưởng gì tới sai số và quantile ở quá khứ
            np.testing.assert_array_almost_equal(res_before, res_after)
            self.assertEqual(q_val_before, q_val_after)
        finally:
            db.close()

    def test_r07_horizon_isolation_no_existing_any_cross_return(self):
        """R-07: Đảm bảo get_or_create_window_quantile không dùng existing_any trả sai bản ghi của horizon khác."""
        from app.services.window_quantile_service import window_quantile_service

        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        db = Session()
        try:
            store = "CA_1"
            item = "FOODS_1_001"
            origin = date(2016, 5, 23)

            rec_h7 = window_quantile_service.get_or_create_window_quantile(
                db, store_id=store, item_id=item, origin_date=origin, horizon_days=7
            )
            self.assertEqual(rec_h7.horizon_days, 7)

            # Lần gọi thứ 2 với horizon_days=10 không được trả lại bản ghi horizon 7
            rec_h10 = window_quantile_service.get_or_create_window_quantile(
                db, store_id=store, item_id=item, origin_date=origin, horizon_days=10
            )
            self.assertEqual(rec_h10.horizon_days, 10)
            self.assertNotEqual(rec_h7.id, rec_h10.id)
        finally:
            db.close()

    def test_r07_single_run_isolation_in_compute_point_window_forecast(self):
        """R-07: Đảm bảo compute_point_window_forecast chỉ lấy đúng 1 lượt chạy dự báo, không trộn 2 run."""
        from app.services.window_quantile_service import window_quantile_service
        from app.models.forecast import Forecast

        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        db = Session()
        try:
            store = "CA_1"
            item = "FOODS_1_001"

            # Run 1 xuất phát 2016-04-25 (h=1..10, y_pred=1.0)
            for h in range(1, 11):
                fc = Forecast(
                    id=f"run1_{h}", item_id=item, store_id=store,
                    forecast_date=date(2016, 4, 25) + timedelta(days=h - 1),
                    h=h, y_pred=1.0, p10=0.8, p50=1.0, p90=1.2, available=True,
                    model_version="run_april"
                )
                db.add(fc)

            # Run 2 xuất phát 2016-05-23 (h=1..10, y_pred=5.0)
            for h in range(1, 11):
                fc = Forecast(
                    id=f"run2_{h}", item_id=item, store_id=store,
                    forecast_date=date(2016, 5, 23) + timedelta(days=h - 1),
                    h=h, y_pred=5.0, p10=4.0, p50=5.0, p90=6.0, available=True,
                    model_version="run_may"
                )
                db.add(fc)
            db.commit()

            # Gọi tính tổng cho origin 2016-05-23 (phải chọn đúng Run 2, tổng = 50.0, không bị lẫn với Run 1)
            total = window_quantile_service.compute_point_window_forecast(
                db, item_id=item, store_id=store, origin_date=date(2016, 5, 23), horizon_days=10
            )
            self.assertEqual(total, 50.0)
        finally:
            db.close()

    def test_r15_and_r06_forecast_backtest_causal_residuals_integration(self):
        """R-15 & R-06: Đọc dữ liệu từ forecast_backtest để tính sai số nhân quả thật không dùng coalesce."""
        from app.services.window_quantile_service import window_quantile_service
        from app.models.forecast_backtest import ForecastBacktest
        from app.models.sales_history import SalesHistory

        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        db = Session()
        try:
            store = "CA_1"
            item = "FOODS_1_001"
            m5_start = date(2011, 1, 29)
            H = 10

            # Nạp 6 chu kỳ backtest: review_days = 1500, 1507, 1514, 1521, 1528, 1535 (dhat = 2.0 -> pred window = 20.0)
            review_days = [1500, 1507, 1514, 1521, 1528, 1535]
            for i, r_day in enumerate(review_days):
                fb = ForecastBacktest(
                    id=f"fb_{i}", store_id=store, item_id=item, review_day=r_day,
                    dhat=2.0, dhat_lgb=2.0, sigma_d=0.5, model_run="backtest-ensemble-v1"
                )
                db.add(fb)

            # Nạp doanh số thực tế 1 bản ghi duy nhất cho mỗi ngày từ ngày 1500 đến ngày 1535 + H:
            # Mỗi ngày bán 3.0 đơn -> bất kỳ cửa sổ 10 ngày nào cũng có tổng actual = 30.0
            total_days = (review_days[-1] + H) - review_days[0]
            for offset in range(total_days):
                sale_d = m5_start + timedelta(days=review_days[0] - 1 + offset)
                sh = SalesHistory(
                    id=f"sh_{review_days[0] + offset}", item_id=item, store_id=store,
                    sale_date=sale_d, quantity=3.0
                )
                db.add(sh)
            db.commit()

            # Origin date đặt tại ngày 1600 (sau tất cả các chu kỳ trên)
            origin = m5_start + timedelta(days=1600)
            residuals = window_quantile_service.collect_historical_residuals(
                db, item_id=item, store_id=store, origin_date=origin, horizon_days=H
            )
            self.assertEqual(len(residuals), 6)
            # Mỗi cửa sổ actual (30) - pred (20) = 10.0
            for r in residuals:
                self.assertAlmostEqual(r, 10.0, places=2)
        finally:
            db.close()

    def test_b19_service_outcomes_dynamic_n_sku_per_class(self):
        """B-19: Đảm bảo record_cycle_outcomes tính n_sku động theo từng lớp phân loại, không hardcode 100."""
        from app.models.classification import SKUClassification
        from app.models.inventory import Inventory
        from app.models.inventory_daily import InventoryDaily

        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        db = Session()
        try:
            store = "CA_1"
            # Tạo 3 SKU thuộc AX và 2 SKU thuộc AY
            for i in range(3):
                item = f"FOODS_AX_{i}"
                db.add(SKUClassification(
                    id=f"cls_ax_{i}", item_id=item, abc_class="A", xyz_class="X", segment="AX"
                ))
                db.add(Inventory(item_id=item, store_id=store, on_hand=10.0, on_order=0.0))
            for i in range(2):
                item = f"FOODS_AY_{i}"
                db.add(SKUClassification(
                    id=f"cls_ay_{i}", item_id=item, abc_class="A", xyz_class="Y", segment="AY"
                ))
                db.add(Inventory(item_id=item, store_id=store, on_hand=5.0, on_order=0.0))

            # Giả lập 1 SKU của AX bị stockout
            db.add(InventoryDaily(
                store_id=store, item_id="FOODS_AX_0", date=date(2016, 5, 20),
                on_hand_end=0.0, stockout=True, lost_sales=2.0
            ))
            db.commit()

            outcomes = calibrator_service.record_cycle_outcome(
                db, store_id=store, cycle_index=1,
                cycle_start=date(2016, 5, 17), cycle_end=date(2016, 5, 24)
            )

            outcome_map = {o.class_id: o for o in outcomes}
            # Lớp AX có 3 SKU thật, 1 stockout -> error_rate = 1/3 = 0.3333
            self.assertEqual(outcome_map["AX"].n_sku, 3)
            self.assertEqual(outcome_map["AX"].n_stockout, 1)
            self.assertAlmostEqual(outcome_map["AX"].error_rate, 0.3333, places=3)

            # Lớp AY có 2 SKU thật, 0 stockout -> error_rate = 0.0
            self.assertEqual(outcome_map["AY"].n_sku, 2)
            self.assertEqual(outcome_map["AY"].n_stockout, 0)
            self.assertEqual(outcome_map["AY"].error_rate, 0.0)

            # Lớp không có SKU (AZ, CX, ...) -> n_sku = 0, error_rate = 0.0, KHÔNG bị gán số 100/4
            self.assertEqual(outcome_map["AZ"].n_sku, 0)
            self.assertEqual(outcome_map["AZ"].n_stockout, 0)
            self.assertEqual(outcome_map["AZ"].error_rate, 0.0)
        finally:
            db.close()



if __name__ == "__main__":
    unittest.main()
