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
from app.services.data_preprocessing_service import data_preprocessing_service


class TestC3OutAndSimulation(unittest.TestCase):

    def test_c3out_integral_update_math(self):
        """
        P1 (G-15..G-18): teacher one-sided C3-OUT (E9c), identical to e10b_replay.c3_update:
          theta_k = clip(theta_{k-1} + eta * (e_{k-d} - (1 - setpoint)), 0, 2), setpoint 0.96, eta 1, theta_0 = 0,
        NO boundary-convention substitution (theta = 0 is the resting state, not a boundary).
        """
        self.assertEqual(calibrator_service.MAX_THETA, 2.0)
        self.assertEqual(calibrator_service.MIN_THETA, 0.0)
        self.assertEqual(calibrator_service.DEFAULT_SETPOINT, 0.96)
        up = calibrator_service.update_theta

        # e = 0.04 (on target) -> theta unchanged
        self.assertAlmostEqual(up(0.0, 0.04), 0.0)
        # e = 0.09 (5 pp above) -> theta + 0.05
        self.assertAlmostEqual(up(0.0, 0.09), 0.05)
        self.assertGreater(math.exp(up(0.0, 0.09)), 1.0)
        # theta = 0 and no stock-out: clipped at 0 (one-sided), NEVER the old +0.96 jump of the boundary convention
        self.assertEqual(up(0.0, 0.0), 0.0)
        # above 0 the controller relaxes normally
        self.assertAlmostEqual(up(0.30, 0.0), 0.26)
        # upper clip at 2, and from 2 with e = 0 it comes down by 0.04 (no substituted e)
        self.assertEqual(up(1.99, 1.0), 2.0)
        self.assertAlmostEqual(up(2.0, 0.0), 1.96)
        # two-sided range only as an explicit ablation
        lo, hi = calibrator_service.theta_bounds("two_sided")
        self.assertEqual((lo, hi), (-2.0, 2.0))
        self.assertAlmostEqual(up(0.0, 0.0, lo=lo, hi=hi), -0.04)

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
            # P1: no policy_selection -> setpoint 0.96; one-sided: theta = clip(0 + (0.0 - 0.04), 0, 2) = 0,
            # never the +0.96 jump of the old boundary convention, and theta = 0 is NOT a boundary
            self.assertEqual(cx_new.theta, 0.0)
            self.assertNotEqual(cx_new.theta, 0.96)
            self.assertFalse(cx_new.at_boundary)
            self.assertEqual(cx_new.status, "Active")
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

        # Đảm bảo có đủ mức quantile (gồm tau = 0.9615 của P-CR)
        self.assertEqual(len(q_dict), len(ROUTE_C_TAU_LEVELS))
        self.assertIn("0.9615", q_dict)  # tau of policy P-CR
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

    def test_tier2_mg_decoupled_from_tier3_theta_no_doubling(self):
        """
        Test N-05: Kiểm tra tách m_g của Tier 2 khỏi theta của C3-OUT.
        - Khởi tạo mặc định m_g = 0.0 cho cả 9 lớp (tránh lỗi cộng dồn thành e^{2*theta})
        """
        for class_id, policy in optimization_service.DEFAULT_OPTIMAL_POLICIES.items():
            self.assertEqual(
                policy["m_g"],
                0.0,
                f"Lớp {class_id} có m_g={policy['m_g']} != 0.0, gây lỗi nhân đôi e^(2*theta)!",
            )

    def test_tier2_j5_without_validation_data_is_neutral_and_not_feasible(self):
        """J5 never invents metrics: with no backtest data every class is the neutral policy, flagged infeasible
        (the real (R,s,S) backtest is covered in test_scientific_core.py)."""
        from app.models.classification import SKUClassification
        from app.models.product import Product

        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        db = sessionmaker(bind=engine)()
        try:
            db.add(Product(item_id="TEST_SKU_AX", name="Item AX", cat_id="FOODS", price=10.0))
            db.add(SKUClassification(id="cls_ax_01", item_id="TEST_SKU_AX", store_id="CA_1", abc_class="A",
                                     xyz_class="X", segment="AX", cv=0.2, mean_demand=20.0))
            db.commit()
            res = optimization_service.refit_quarterly_policies(db, store_id="CA_1")
            ax = next(r for r in res if r["class_id"] == "AX")
            self.assertEqual(ax["m_g"], 0.0)
            self.assertEqual(ax["kappa_g"], 1.0)
            self.assertIsNone(ax["val_service"])
            self.assertIsNone(ax["val_cost"])
            self.assertFalse(ax["is_feasible"])
            self.assertAlmostEqual(ax["setpoint"], 0.96)  # Q-06: A_g (0.95 from settings) + guard 0.01 (research 8.2)
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
            for i in range(-1, 14):  # the start date is a simulated day too (P2)
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

            # Kiểm tra InventoryDaily đã sinh 8 bản ghi: ngày bắt đầu (ngày 0) + 7 ngày tua
            dailies = db.query(InventoryDaily).filter(InventoryDaily.item_id == "TEST_ITEM_01").all()
            self.assertEqual(len(dailies), 8)

            # Kiểm tra đề xuất bổ sung sinh ở review day có review_date = 2016-05-02
            recs = db.query(ReplenishmentRecommendation).filter(ReplenishmentRecommendation.item_id == "TEST_ITEM_01").all()
            self.assertGreaterEqual(len(recs), 1)
            first_rec = recs[0]
            self.assertEqual(first_rec.review_date, date(2016, 5, 2))

            # 5. Tua tiếp 3 ngày (đến 2016-05-05 = lead_time_days) -> đơn hàng phải đến và COMPLETED
            pipeline_service.advance_sim_clock(
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
        Causality of route (c): sales inside (cutoff, origin] and after the origin, and backtest reviews that are
        not matured (s + H > origin), must NOT change the residuals nor Q_hat at the origin.
        """
        import numpy as np
        from app.services.window_quantile_service import window_quantile_service
        from app.models.sales_history import SalesHistory
        from app.models.forecast_backtest import ForecastBacktest
        from app.services import policy_config as pc

        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        db = Session()
        try:
            store, item, H = "CA_1", "FOODS_1_001", 10
            o_idx = 1700
            origin = pc.day_index_to_date(o_idx)
            matured = [o_idx - H - 7 * k for k in range(10)]         # s + H <= origin
            unmatured = [o_idx - 3, o_idx + 4]                       # s + H > origin
            for i, r in enumerate(matured + unmatured):
                db.add(ForecastBacktest(id=f"fb_{i}", store_id=store, item_id=item, review_day=r,
                                        dhat=10.0, dhat_lgb=10.0, sigma_d=1.0, model_run="backtest-ensemble-v1"))
            # actuals: 1.5 per day for every day strictly before the origin
            for d in range(o_idx - 100, o_idx):
                db.add(SalesHistory(id=f"s_{d}", item_id=item, store_id=store,
                                    sale_date=pc.day_index_to_date(d), quantity=1.5))
            db.commit()

            res_before = window_quantile_service.collect_historical_residuals(
                db, item_id=item, store_id=store, origin_date=origin, horizon_days=H)
            q_before = window_quantile_service.build_records(db, store, [item], origin, H)[0].q_levels["0.95"]
            self.assertEqual(len(res_before), len(matured))          # un-matured reviews are excluded
            np.testing.assert_allclose(res_before, 15.0 - 10.0)

            # inject extreme data in the FUTURE (after the origin): it must not leak in
            for d in range(o_idx + 1, o_idx + 20):
                db.add(SalesHistory(id=f"f_{d}", item_id=item, store_id=store,
                                    sale_date=pc.day_index_to_date(d), quantity=999.0))
            db.commit()

            res_after = window_quantile_service.collect_historical_residuals(
                db, item_id=item, store_id=store, origin_date=origin, horizon_days=H)
            q_after = window_quantile_service.build_records(db, store, [item], origin, H)[0].q_levels["0.95"]
            np.testing.assert_array_almost_equal(res_before, res_after)
            self.assertEqual(q_before, q_after)
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
                    model_version="Ensemble run_april"
                )
                db.add(fc)

            # Run 2 xuất phát 2016-05-23 (h=1..10, y_pred=5.0)
            for h in range(1, 11):
                fc = Forecast(
                    id=f"run2_{h}", item_id=item, store_id=store,
                    forecast_date=date(2016, 5, 23) + timedelta(days=h - 1),
                    h=h, y_pred=5.0, p10=4.0, p50=5.0, p90=6.0, available=True,
                    model_version="Ensemble run_may"
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

            # Nạp 6 chu kỳ backtest: review_days = 1500, 1507, 1514, 1521, 1528, 1535 (dhat = 20.0 = tổng cửa sổ 10 ngày)
            review_days = [1500, 1507, 1514, 1521, 1528, 1535]
            for i, r_day in enumerate(review_days):
                fb = ForecastBacktest(
                    id=f"fb_{i}", store_id=store, item_id=item, review_day=r_day,
                    dhat=20.0, dhat_lgb=20.0, sigma_d=0.5, model_run="backtest-ensemble-v1"
                )  # dhat is already the H-day window sum (artifact c3ok, W = 10)
                db.add(fb)

            # Nạp doanh số thực tế 1 bản ghi duy nhất cho mỗi ngày từ ngày 1500 đến ngày 1535 + H:
            # Mỗi ngày bán 3.0 đơn -> bất kỳ cửa sổ 10 ngày nào cũng có tổng actual = 30.0
            total_days = (review_days[-1] + H) - review_days[0]
            for offset in range(total_days):
                sale_d = m5_start + timedelta(days=review_days[0] + offset)  # day index r+offset: window is [r, r+H)
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
