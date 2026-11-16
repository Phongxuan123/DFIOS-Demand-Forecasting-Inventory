from typing import Dict, Any

# Round 5 (U-06): language-independent codes of the Vietnamese policy texts below (client-side i18n).
# description_code / strategy_code / replenishment_policy_code are per segment ("abc_A_xyz_X", "strategy_AX", ...);
# the enumerations below are shared by several segments.
_REVIEW_FREQUENCY_CODE = {"AX": "daily", "AY": "weekly", "AZ": "weekly_or_event", "BX": "biweekly",
                          "BY": "biweekly", "BZ": "monthly", "CX": "monthly", "CY": "monthly",
                          "CZ": "quarterly_or_on_demand"}
_SAFETY_STOCK_CODE = {"AX": "low", "AY": "medium", "AZ": "high", "BX": "standard", "BY": "medium",
                      "BZ": "cautious", "CX": "high", "CY": "moderate", "CZ": "none_or_minimal"}
_PRIORITY_CODE = {"AX": "critical", "AY": "high", "AZ": "high", "BX": "medium", "BY": "medium",
                  "BZ": "medium_low", "CX": "low", "CY": "low", "CZ": "very_low"}

# Bảng luật chính sách và khuyến nghị chiến lược tồn kho cho 9 phân khúc ma trận ABC/XYZ (UC28)
# Lưu tập trung tại config/seed, không hardcode rải rác
CLASSIFICATION_RECOMMENDATIONS: Dict[str, Dict[str, Any]] = {
    "AX": {
        "segment": "AX",
        "description": "Giá trị doanh thu cao (A), nhu cầu rất ổn định (X)",
        "strategy": "Kiểm soát gắt gao theo ngày (Strict Daily Control), mô hình Just-In-Time (JIT), duy trì Service Level cao nhất (98-99%).",
        "review_frequency": "Hàng ngày (Daily)",
        "replenishment_policy": "Đặt hàng liên tục/chu kỳ ngắn theo dự báo chính xác, quy mô lô nhỏ linh hoạt.",
        "safety_stock_level": "Thấp (Tồn kho an toàn tối thiểu do phương sai nhu cầu nhỏ).",
        "priority": "Rất cao (Critical)",
    },
    "AY": {
        "segment": "AY",
        "description": "Giá trị doanh thu cao (A), nhu cầu biến động trung bình (Y)",
        "strategy": "Kiểm soát chặt chẽ, cập nhật dự báo ML hàng tuần, thiết lập tồn kho an toàn động để đệm biến động.",
        "review_frequency": "Hàng tuần (Weekly)",
        "replenishment_policy": "Đặt hàng theo điểm đặt hàng lại (ROP) kết hợp dự báo ngắn hạn.",
        "safety_stock_level": "Trung bình (Đủ bảo vệ chu kỳ giao hàng khi nhu cầu dao động).",
        "priority": "Cao (High)",
    },
    "AZ": {
        "segment": "AZ",
        "description": "Giá trị doanh thu cao (A), nhu cầu biến động mạnh / khó dự báo (Z)",
        "strategy": "Theo dõi sát sao từng đơn hàng, cảnh báo sớm biến động, phối hợp chặt chẽ với nhà cung cấp rút ngắn lead time.",
        "review_frequency": "Hàng tuần hoặc theo sự kiện/khuyến mãi",
        "replenishment_policy": "Đặt hàng linh hoạt theo dự báo quantile (P90), tránh giữ tồn kho quá lớn.",
        "safety_stock_level": "Cao (Đệm rủi ro gián đoạn cho sản phẩm doanh số chủ lực).",
        "priority": "Cao (High)",
    },
    "BX": {
        "segment": "BX",
        "description": "Giá trị doanh thu trung bình (B), nhu cầu rất ổn định (X)",
        "strategy": "Quản lý bán tự động, áp dụng quy tắc đặt hàng cố định EOQ và ROP chuẩn.",
        "review_frequency": "2 tuần một lần (Bi-weekly)",
        "replenishment_policy": "Tự động kích hoạt đơn hàng bổ sung khi mức tồn chạm ROP.",
        "safety_stock_level": "Tiêu chuẩn (Vừa đủ theo độ tin cậy giao hàng).",
        "priority": "Trung bình (Medium)",
    },
    "BY": {
        "segment": "BY",
        "description": "Giá trị doanh thu trung bình (B), nhu cầu biến động vừa (Y)",
        "strategy": "Giám sát định kỳ, dự báo theo mô hình thống kê/ML định kỳ, điều chỉnh tham số theo mùa.",
        "review_frequency": "2 tuần một lần (Bi-weekly)",
        "replenishment_policy": "Đặt hàng theo chu kỳ định kỳ kết hợp đánh giá tồn kho an toàn.",
        "safety_stock_level": "Trung bình.",
        "priority": "Trung bình (Medium)",
    },
    "BZ": {
        "segment": "BZ",
        "description": "Giá trị doanh thu trung bình (B), nhu cầu thất thường (Z)",
        "strategy": "Hạn chế tồn trữ quá mức, theo dõi biến động thị trường, đàm phán hợp đồng cung ứng linh hoạt.",
        "review_frequency": "Hàng tháng (Monthly)",
        "replenishment_policy": "Đặt hàng theo nhu cầu thực tế phát sinh, xem xét gom đơn.",
        "safety_stock_level": "Thận trọng, tránh tồn ứ vốn lưu động.",
        "priority": "Trung bình thấp (Medium-Low)",
    },
    "CX": {
        "segment": "CX",
        "description": "Giá trị doanh thu thấp (C), nhu cầu rất ổn định (X)",
        "strategy": "Tự động hóa toàn diện quy trình mua hàng, đặt hàng theo lô lớn để hưởng chiết khấu vận chuyển.",
        "review_frequency": "Hàng tháng (Monthly)",
        "replenishment_policy": "Đặt hàng chu kỳ dài (EOQ lớn), kiểm soát bằng ngưỡng tối thiểu.",
        "safety_stock_level": "Cao (Chi phí lưu kho thấp, chi phí thiếu hàng không đáng đánh đổi).",
        "priority": "Thấp (Low)",
    },
    "CY": {
        "segment": "CY",
        "description": "Giá trị doanh thu thấp (C), nhu cầu biến động vừa (Y)",
        "strategy": "Gom đơn định kỳ với các mặt hàng khác, đơn giản hóa thủ tục đặt hàng.",
        "review_frequency": "Hàng tháng (Monthly)",
        "replenishment_policy": "Đặt hàng bổ sung định kỳ theo mốc thời gian cố định.",
        "safety_stock_level": "Vừa phải.",
        "priority": "Thấp (Low)",
    },
    "CZ": {
        "segment": "CZ",
        "description": "Giá trị doanh thu thấp (C), nhu cầu cực kỳ thất thường (Z)",
        "strategy": "Giảm thiểu chi phí quản lý, xem xét loại bỏ khỏi danh mục hoặc chỉ mua khi có đơn đặt trước (Make/Buy-to-order).",
        "review_frequency": "Hàng quý hoặc theo yêu cầu phát sinh",
        "replenishment_policy": "Không tự động đặt hàng; gom đơn khi có nhu cầu thực tế.",
        "safety_stock_level": "Không duy trì hoặc duy trì tối thiểu.",
        "priority": "Rất thấp (Very Low)",
    },
}

for _seg, _rec in CLASSIFICATION_RECOMMENDATIONS.items():
    _rec.update({
        "description_code": f"abc_{_seg[0]}_xyz_{_seg[1]}",
        "strategy_code": f"strategy_{_seg}",
        "replenishment_policy_code": f"replenishment_{_seg}",
        "review_frequency_code": _REVIEW_FREQUENCY_CODE[_seg],
        "safety_stock_level_code": _SAFETY_STOCK_CODE[_seg],
        "priority_code": _PRIORITY_CODE[_seg],
    })
