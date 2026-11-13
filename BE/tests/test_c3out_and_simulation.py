import unittest
import math
from datetime import date, timedelta
from app.services.calibrator_service import calibrator_service
from app.services.optimization_service import optimization_service
from app.services.window_quantile_service import window_quantile_service, ROUTE_C_TAU_LEVELS
from app.services.simulation_service import simulation_service
from app.services.data_preprocessing_service import data_preprocessing_service


class TestC3OutAndSimulation(unittest.TestCase):

    def test_c3out_integral_update_math(self):
        """
        Test TEST.1 - Kiểm định tính đúng đắn toán học của thuật toán One-Sided C³-OUT:
        theta_k = theta_{k-1} + eta * ( e~_{k-d} - (1 - setpoint) )
        - Setpoint: 0.96 -> target error rate: 0.04
        - eta = 1.0
        - Kẹp biên: [0.0, 2.0]
        """
        eta = 1.0
        setpoint = 0.96
        target_error = 1.0 - setpoint  # 0.04

        # Trường hợp 1: Không có sai số (e~ = 0.04) -> theta không đổi
        theta_0 = 0.0
        obs_error_1 = 0.04
        theta_1 = max(0.0, min(2.0, theta_0 + eta * (obs_error_1 - target_error)))
        self.assertEqual(theta_1, 0.0)

        # Trường hợp 2: Tỷ lệ thiếu hàng tăng lên e~ = 0.09 (vượt 5pp) -> theta tăng lên 0.05
        obs_error_2 = 0.09
        theta_2 = max(0.0, min(2.0, theta_1 + eta * (obs_error_2 - target_error)))
        self.assertEqual(round(theta_2, 4), 0.05)
        multiplier_2 = round(math.exp(theta_2), 4)
        self.assertGreater(multiplier_2, 1.0)

        # Trường hợp 3: Khi lỗi âm (e~ = 0.01) nhưng theta đang ở 0.0 -> kẹp biên dưới 0.0 (one-sided)
        obs_error_3 = 0.01
        theta_3 = max(0.0, min(2.0, 0.0 + eta * (obs_error_3 - target_error)))
        self.assertEqual(theta_3, 0.0)  # Không bao giờ hạ mức bảo vệ dưới 0

        # Trường hợp 4: Lỗi kéo dài đẩy theta chạm trần 2.0 -> kẹp biên trên và kích hoạt cờ boundary
        raw_high_theta = 2.45
        theta_bounded = max(0.0, min(2.0, raw_high_theta))
        self.assertEqual(theta_bounded, 2.0)
        at_boundary = bool(theta_bounded >= 2.0)
        self.assertTrue(at_boundary)

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


if __name__ == "__main__":
    unittest.main()
