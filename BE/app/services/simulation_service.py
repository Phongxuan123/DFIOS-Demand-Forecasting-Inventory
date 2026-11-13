import csv
import os
from typing import Dict, List, Optional, Any
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.product import Product
from app.models.inventory_param import InventoryParam
from app.models.system_setting import SystemSetting
from app.schemas.simulation import PolicySimulationMetric, PolicyComparisonResponse


class SimulationService:
    """
    Module What-If Simulation Đối đầu Chính sách Tồn kho (Task API.5):
    Đối chiếu 4 chính sách tồn kho dựa trên kiểm nghiệm thực nghiệm M5 Walmart (72 chu kỳ review):
    - P0: Cổ điển (Gaussian SS + ROP + EOQ / B0 Baseline)
    - P1: Raw Route (c) Quantile (B2 Tĩnh đóng băng, không guard band)
    - P4: Tối ưu Chi phí Phân lớp (P-CR Cost-optimal Setpoint, REFIT-RSS-EOQ-G)
    - P6: C³-OUT Vòng kín (Adaptive Closed-Loop Control)

    Tuân thủ mô hình chi phí chuẩn A3 (research.md §7.2):
    - Phí lưu kho h = 0.002 * sell_price / ngày
    - Phí đặt hàng c = 2.0 $ / đơn
    - Phí phạt hết hàng b = 0.35 * sell_price / đơn vị thiếu
    """

    HOLDING_COST_RATE_PER_DAY = 0.002
    ORDERING_COST_PER_ORDER = 2.0
    STOCKOUT_PENALTY_RATE = 0.35

    @staticmethod
    def _load_c3ok_results() -> Dict[str, Dict[str, float]]:
        """
        Đọc dữ liệu kiểm định thực nghiệm chuẩn từ c3ok_results.csv.
        Dữ liệu gốc trên 3.049 SKU qua 72 chu kỳ review (504 ngày).
        """
        base_dir = os.path.dirname(__file__)
        candidates = [
            os.path.abspath(os.path.join(base_dir, "..", "..", "MODEL", "c3ok_results.csv")),
            os.path.abspath(os.path.join(base_dir, "..", "..", "..", "c3ok_artifacts", "c3ok_artifacts", "c3ok_results.csv")),
            os.path.abspath(os.path.join(base_dir, "..", "..", "..", "BE", "MODEL", "c3ok_results.csv")),
        ]

        csv_path = None
        for p in candidates:
            if os.path.isfile(p):
                csv_path = p
                break

        results: Dict[str, Dict[str, float]] = {}
        if csv_path:
            with open(csv_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    name = row.get("policy", "")
                    try:
                        results[name] = {
                            "tau": float(row.get("tau", 0.0)),
                            "csl": float(row.get("CSL", 0.0)),
                            "fill_rate": float(row.get("fill_rate", 0.0)),
                            "hold_bikip": float(row.get("hold_BIKIP", 0.0)),
                            "lost_bikip": float(row.get("lost_BIKIP", 0.0)),
                            "order_bikip": float(row.get("order_BIKIP", 0.0)),
                            "cost_bikip": float(row.get("cost_BIKIP", 0.0)),
                            "cost_paper": float(row.get("cost_PAPER", 0.0)),
                        }
                    except (ValueError, TypeError):
                        continue

        # Fallback dữ liệu chuẩn từ c3ok_results.csv nếu không đọc được file
        if not results:
            results = {
                "B0 DFIOS τ=0.95": {
                    "tau": 0.95, "csl": 0.90709, "fill_rate": 0.94050,
                    "hold_bikip": 714598.98, "lost_bikip": 773751.84, "order_bikip": 1923694.0,
                    "cost_bikip": 3412044.82, "cost_paper": 767052.47
                },
                "B2 DFIOS τ*=0.99 [BIKIP]": {
                    "tau": 0.99, "csl": 0.93362, "fill_rate": 0.95560,
                    "hold_bikip": 852948.76, "lost_bikip": 575342.87, "order_bikip": 1928790.0,
                    "cost_bikip": 3357081.62, "cost_paper": 699361.32
                },
                "P-CR C³-OUT τ=0.9615 [BIKIP]": {
                    "tau": 0.9615, "csl": 0.96054, "fill_rate": 0.97498,
                    "hold_bikip": 984863.21, "lost_bikip": 307251.18, "order_bikip": 1902784.0,
                    "cost_bikip": 3194898.39, "cost_paper": 598919.84
                },
                "P C³-OUT τ=0.95": {
                    "tau": 0.95, "csl": 0.94895, "fill_rate": 0.96833,
                    "hold_bikip": 900606.68, "lost_bikip": 391639.43, "order_bikip": 1908706.0,
                    "cost_bikip": 3200952.10, "cost_paper": 629384.80
                },
            }
        return results

    def compare_policies(
        self,
        db: Optional[Session] = None,
        store_id: str = "CA_1",
        horizon_days: int = 90,
        target_service_level: float = 0.96,
    ) -> PolicyComparisonResponse:
        """
        Chạy mô phỏng đối đầu 4 chính sách tồn kho dựa trên số liệu thực nghiệm M5 (c3ok_results.csv)
        theo mô hình chi phí chuẩn A3.
        """
        benchmark_results = self._load_c3ok_results()

        # Xác định số lượng SKU và đơn giá trung bình từ DB (nếu có)
        if db is not None:
            products = db.query(Product).all()
            sku_count = len(products) if products else 3049
            avg_price_scalar = db.query(func.avg(Product.sell_price)).scalar()
            avg_price = float(avg_price_scalar) if avg_price_scalar and avg_price_scalar > 0 else 3.50
        else:
            sku_count = 3049
            avg_price = 3.50

        # Hệ số quy đổi theo quy mô SKU và số ngày mô phỏng (chuẩn M5: 3.049 SKU, 504 ngày)
        ref_skus = 3049.0
        ref_days = 504.0
        scale = (sku_count / ref_skus) * (horizon_days / ref_days)

        # Định nghĩa 4 chính sách tương ứng từ bảng thực nghiệm c3ok
        policy_configs = [
            (
                "P0_classical",
                "P0 - Cổ điển (Gaussian SS + ROP)",
                "B0 DFIOS τ=0.95",
                "Baseline tĩnh công thức truyền thống Z*sigma_L ở mức quantile τ=0.95. Bị thiếu phủ nghiêm trọng trên chuỗi nhu cầu gián đoạn.",
            ),
            (
                "P1_raw_quantile",
                "P1 - Raw Route (c) Quantile",
                "B2 DFIOS τ*=0.99 [BIKIP]",
                "Dùng phân phối thực nghiệm không có guard band và không bù sai số động theo chu kỳ.",
            ),
            (
                "P4_frozen_refit",
                "P4/P-CR - Tối ưu Chi phí Phân lớp",
                "P-CR C³-OUT τ=0.9615 [BIKIP]",
                "Tối ưu hóa setpoint quantile theo từng phân lớp ABC/XYZ (lưới mịn), đạt chi phí tối thiểu theo mô hình A3.",
            ),
            (
                "P6_c3out_closed_loop",
                "P6 - C³-OUT Vòng kín",
                "P C³-OUT τ=0.95",
                "Bộ điều khiển tích phân một phía C³-OUT tự động hiệu chỉnh hệ số an toàn θ_g theo từng chu kỳ để ổn định mức phục vụ.",
            ),
        ]

        policies: List[PolicySimulationMetric] = []
        for policy_id, policy_name, benchmark_key, desc in policy_configs:
            row = benchmark_results.get(benchmark_key)
            if not row:
                continue

            hold_cost = round(row["hold_bikip"] * scale, 2)
            lost_cost = round(row["lost_bikip"] * scale, 2)
            ord_cost = round(row["order_bikip"] * scale, 2)
            tot_cost = round(hold_cost + lost_cost + ord_cost, 2)

            csl = row["csl"]
            avail_pct = round(csl * 100.0, 1)

            # Tính số đơn hàng và số đơn vị thiếu theo mô hình A3
            total_orders = max(1, int(round((row["order_bikip"] / self.ORDERING_COST_PER_ORDER) * scale)))
            stockout_unit_cost = max(0.5, self.STOCKOUT_PENALTY_RATE * avg_price)
            total_stockouts = max(0, int(round((row["lost_bikip"] / stockout_unit_cost) * scale)))

            # Kiểm tra tính khả thi: CSL thực nghiệm phải >= target_service_level
            is_feasible = bool(csl >= target_service_level)

            policies.append(
                PolicySimulationMetric(
                    policy_id=policy_id,
                    policy_name=policy_name,
                    description=desc,
                    total_cost=tot_cost,
                    holding_cost=hold_cost,
                    ordering_cost=ord_cost,
                    stockout_cost=lost_cost,
                    availability=avail_pct,
                    total_orders=total_orders,
                    total_stockouts=total_stockouts,
                    is_feasible=is_feasible,
                    cost_increase_vs_best=0.0,
                )
            )

        # Quyết định chính sách đề xuất:
        # 1. Trong các chính sách khả thi (đạt SLA), chọn chính sách có tổng chi phí thấp nhất.
        # 2. Nếu không có chính sách nào đạt SLA, chọn chính sách có availability cao nhất (theo research.md §7.4).
        feasible_policies = [p for p in policies if p.is_feasible]
        if feasible_policies:
            best_feasible = min(feasible_policies, key=lambda p: p.total_cost)
            recommended_policy = best_feasible.policy_id
            best_cost = best_feasible.total_cost
        else:
            best_service = max(policies, key=lambda p: p.availability)
            recommended_policy = best_service.policy_id
            best_cost = min(p.total_cost for p in policies)

        for p in policies:
            p.cost_increase_vs_best = round(max(0.0, p.total_cost - best_cost), 2)

        # Tổng hợp insight trung thực khoa học
        insights: List[List[str]] = []
        rec_policy = next((p for p in policies if p.policy_id == recommended_policy), policies[0])

        if feasible_policies:
            insight_rec = (
                f"Chính sách đề xuất {rec_policy.policy_name} đáp ứng yêu cầu SLA >= {target_service_level*100:.1f}% "
                f"(đạt CSL {rec_policy.availability:.1f}%) với tổng chi phí tối ưu ({rec_policy.total_cost:,.2f} $)."
            )
        else:
            insight_rec = (
                f"Cảnh báo: Không có chính sách nào đạt SLA cam kết {target_service_level*100:.1f}%. "
                f"Chính sách tiệm cận tốt nhất là {rec_policy.policy_name} (đạt CSL {rec_policy.availability:.1f}%)."
            )

        insights_list = [
            insight_rec,
            (
                "Chi phí tính theo chuẩn A3 (research.md §7.2): h = 0.002 * giá/ngày, c = 2.0 $/đơn, b = 0.35 * giá. "
                "Thực nghiệm cho thấy P4 (P-CR) đạt chi phí thấp hơn P6 khi cùng thỏa mãn SLA nhờ tối ưu hóa setpoint phân lớp tĩnh."
            ),
            (
                "Chính sách P6 (C³-OUT) đóng vai trò bộ điều khiển thích nghi bù trừ sai lệch theo chu kỳ "
                "nhằm đảm bảo mức phục vụ trước biến động nhu cầu, không phải là bộ giảm chi phí vô điều kiện."
            ),
        ]

        return PolicyComparisonResponse(
            store_id=store_id,
            simulation_horizon_days=horizon_days,
            sku_count=sku_count,
            recommended_policy=recommended_policy,
            policies=policies,
            insights=insights_list,
        )


simulation_service = SimulationService()
