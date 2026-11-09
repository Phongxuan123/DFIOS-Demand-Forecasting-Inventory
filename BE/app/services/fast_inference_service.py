import math
import numpy as np
import pandas as pd
from datetime import timedelta
from typing import Dict, List, Any, Optional, Tuple


class FastInferenceService:
    """
    Dịch vụ suy luận dự báo nhanh CPU 3-5 giây cho kho hàng mới (Task PRE.4):
    - Tự động trích xuất đặc trưng chuỗi thời gian (Lag 7, 14, 28, Rolling 7, 28).
    - Dự báo 28 ngày tương lai (h = 1..28) bằng mô hình thống kê SBA (Syntetos-Boylan Approximation)
      kết hợp hiệu chỉnh mùa vụ ngày trong tuần, cực kỳ tối ưu cho nhu cầu bán lẻ gián đoạn/thưa.
    """

    def compute_features(self, series: pd.Series) -> Dict[str, float]:
        """
        Trích xuất nhanh các đặc trưng thống kê và lag từ chuỗi doanh số lịch sử.
        """
        vals = series.values
        n = len(vals)
        if n == 0:
            return {"mean": 0.0, "std": 0.0, "lag_7": 0.0, "lag_14": 0.0, "lag_28": 0.0, "roll_7": 0.0, "roll_28": 0.0}

        mean_val = float(np.mean(vals))
        std_val = float(np.std(vals)) if n > 1 else 0.0

        lag_7 = float(vals[-7]) if n >= 7 else mean_val
        lag_14 = float(vals[-14]) if n >= 14 else mean_val
        lag_28 = float(vals[-28]) if n >= 28 else mean_val

        roll_7 = float(np.mean(vals[-7:])) if n >= 7 else mean_val
        roll_28 = float(np.mean(vals[-28:])) if n >= 28 else mean_val

        return {
            "mean": mean_val,
            "std": std_val,
            "lag_7": lag_7,
            "lag_14": lag_14,
            "lag_28": lag_28,
            "roll_7": roll_7,
            "roll_28": roll_28,
        }

    def sba_croston_forecast(self, sales: np.ndarray, horizon: int = 28) -> Tuple[float, float]:
        """
        Phương pháp SBA (Syntetos-Boylan Approximation) cho nhu cầu gián đoạn:
        Hiệu chỉnh độ lệch của Croston: z_sba = (1 - alpha/2) * (z / p)
        Trả về (dự báo điểm hằng ngày, độ lệch chuẩn ước lượng).
        """
        non_zero_indices = np.where(sales > 0)[0]
        if len(non_zero_indices) == 0:
            return 0.0, 0.1

        # Kích thước nhu cầu không âm và khoảng cách giữa các lần phát sinh nhu cầu
        demands = sales[non_zero_indices]
        intervals = np.diff(np.concatenate(([0], non_zero_indices)))
        intervals[0] = max(1, non_zero_indices[0])

        alpha = 0.1
        z = demands[0]
        p = float(intervals[0])

        for d, i in zip(demands[1:], intervals[1:]):
            z = z + alpha * (d - z)
            p = p + alpha * (i - p)

        p = max(1.0, p)
        # Hiệu chỉnh SBA chống thổi phồng nhu cầu của Croston
        sba_rate = (1.0 - alpha / 2.0) * (z / p)
        sba_rate = max(0.0, float(sba_rate))

        std_est = max(0.2, float(np.std(sales)))
        return sba_rate, std_est

    def generate_fast_forecast(
        self,
        clean_df: pd.DataFrame,
        horizon: int = 28,
        model_version: str = "fast-inference-sba-v1.0",
    ) -> pd.DataFrame:
        """
        Thực hiện suy luận nhanh cho toàn bộ SKU trong DataFrame sạch:
        Sinh 28 ngày dự báo (h = 1..28) kèm các khoảng tin cậy p10, p50, p90.
        """
        results = []

        for (store_id, item_id), group in clean_df.groupby(["store_id", "item_id"]):
            group = group.sort_values("sale_date")
            sales_series = group["sales"].values
            last_date = group["sale_date"].max()

            # Tính hệ số theo ngày trong tuần (day-of-week seasonality)
            dow_sales = group.groupby(group["sale_date"].dt.dayofweek)["sales"].mean()
            overall_mean = max(0.01, float(np.mean(sales_series)))
            dow_weights = (dow_sales / overall_mean).to_dict()

            base_rate, std_est = self.sba_croston_forecast(sales_series, horizon=horizon)

            for h in range(1, horizon + 1):
                fc_date = last_date + timedelta(days=h)
                w = dow_weights.get(fc_date.weekday(), 1.0)
                # Giới hạn trọng số mùa vụ [0.5, 2.0] để không bị ngoại lai quá mức
                w = min(2.0, max(0.5, w))

                y_pred = round(base_rate * w, 3)
                p10 = round(max(0.0, y_pred - 1.282 * std_est * math.sqrt(h / 7.0)), 3)
                p50 = y_pred
                p90 = round(y_pred + 1.282 * std_est * math.sqrt(h / 7.0), 3)

                results.append({
                    "id": f"{item_id}_{store_id}_{fc_date.strftime('%Y-%m-%d')}_{h}",
                    "item_id": item_id,
                    "store_id": store_id,
                    "forecast_date": fc_date.date(),
                    "h": h,
                    "y_pred": y_pred,
                    "p10": p10,
                    "p50": p50,
                    "p90": p90,
                    "available": True,
                    "model_version": model_version,
                })

        return pd.DataFrame(results)


fast_inference_service = FastInferenceService()
