import math
import numpy as np
import pandas as pd
from datetime import date, timedelta, datetime, timezone
from typing import Dict, List, Optional, Any, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.forecast_window_quantile import ForecastWindowQuantile
from app.models.forecast import Forecast, ForecastOverride
from app.models.sales_history import SalesHistory
from app.models.product import Product

ROUTE_C_TAU_LEVELS = [
    0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.60, 0.70, 0.75,
    0.80, 0.85, 0.90, 0.93, 0.95, 0.96, 0.97, 0.975, 0.98, 0.985, 0.99, 0.995, 0.999
]

# Chuẩn Gaussian Z-scores cho fallback khi thiếu mẫu thực nghiệm
GAUSSIAN_Z = {
    0.05: -1.645, 0.10: -1.282, 0.15: -1.036, 0.20: -0.842, 0.25: -0.674,
    0.30: -0.524, 0.40: -0.253, 0.50: 0.0,    0.60: 0.253,  0.70: 0.524,
    0.75: 0.674,  0.80: 0.842,  0.85: 1.036,  0.90: 1.282,  0.93: 1.476,
    0.95: 1.645,  0.96: 1.751,  0.97: 1.881,  0.975: 1.960, 0.98: 2.054,
    0.985: 2.170, 0.99: 2.326,  0.995: 2.576, 0.999: 3.090
}


class WindowQuantileService:
    """
    Cầu nối Route (c) – Phân phối Nhu cầu Cửa sổ H = L + R (Giai đoạn 3 / Task BR.1):
    - Tính tổng dự báo cửa sổ F_hat(H).
    - Thu thập sai số thực nghiệm r(H) = D(H) - F_hat(H) trên các điểm gốc đã chín (đảm bảo tính nhân quả).
    - Tính dải 19 mức quantile thực nghiệm Q_hat(tau) = max(0, F_hat(H) + Percentile_tau(r)).
    - Áp dụng Quantile Floor = 1.0 cho SKU có doanh số để tránh Q=0 khi bán chậm.
    """

    def compute_point_window_forecast(
        self,
        db: Session,
        item_id: str,
        store_id: str,
        origin_date: date,
        horizon_days: int = 10,
    ) -> float:
        """
        Tính tổng dự báo điểm trên cửa sổ bảo vệ H ngày: F_hat(H) = sum_{h=1}^H y_hat_h
        """
        # 1. Thử lấy từ bảng forecast kết hợp overrides hiệu dụng (B-01, B-04, N-10 & N-13)
        # Cô lập hoàn toàn khỏi fast-inference-sba
        fc_records = (
            db.query(Forecast.forecast_date, Forecast.h, Forecast.y_pred)
            .filter(
                Forecast.item_id == item_id,
                Forecast.store_id == store_id,
                Forecast.forecast_date >= origin_date,
                Forecast.h <= horizon_days,
                (Forecast.model_version != "fast-inference-sba") | (Forecast.model_version.is_(None)),
            )
            .order_by(Forecast.h.asc())
            .all()
        )

        if fc_records and len(fc_records) >= horizon_days:
            # Tra cứu override đang hoạt động (B-04: hỗ trợ cả horizon h)
            overrides = (
                db.query(ForecastOverride.forecast_date, ForecastOverride.h, ForecastOverride.override_value)
                .filter(
                    ForecastOverride.item_id == item_id,
                    ForecastOverride.store_id == store_id,
                    ForecastOverride.is_active == True,
                )
                .all()
            )
            ov_map = {}
            for ov in overrides:
                ov_map[ov.forecast_date] = float(ov.override_value)
                if ov.h is not None:
                    ov_map[(ov.forecast_date, ov.h)] = float(ov.override_value)

            total_val = sum(
                ov_map.get((r.forecast_date, r.h), ov_map.get(r.forecast_date, float(r.y_pred)))
                for r in fc_records[:horizon_days]
            )
            return float(total_val)

        # 2. Nếu thiếu dữ liệu forecast, fallback từ doanh số trung bình gần nhất * H
        past_sales = (
            db.query(func.avg(SalesHistory.quantity))
            .filter(
                SalesHistory.item_id == item_id,
                SalesHistory.store_id == store_id,
                SalesHistory.sale_date <= origin_date,
            )
            .scalar()
        )
        avg_rate = float(past_sales) if past_sales is not None else 1.0
        return float(round(avg_rate * horizon_days, 2))

    def collect_historical_residuals(
        self,
        db: Session,
        item_id: str,
        store_id: str,
        origin_date: date,
        horizon_days: int = 10,
        max_origins: int = 52,
    ) -> np.ndarray:
        """
        Thu thập sai số lịch sử trên cửa sổ H ngày từ các mốc thời gian đã chín (s + H <= origin_date).
        Đảm bảo tính nhân quả tuyệt đối (Zero lookahead bias).
        Loại bỏ hoàn toàn cơ chế coalesce(y_pred, quantity) làm triệt tiêu sai số về 0 (N-10 & N-13).
        """
        cutoff_date = origin_date - timedelta(days=horizon_days)

        # 1. Thu thập dữ liệu thực tế và dự báo Ensemble đồng thời trên các mốc thời gian đã chín
        # Sai số cửa sổ thực nghiệm chuẩn tắc: r(H) = D(H) - F_hat(H) (Route c, research.md §7.2, R-06)
        # Chỉ ghép các bản ghi có cả dự báo hợp lệ (không thuộc fast-inference-sba)
        merged_query = (
            db.query(
                SalesHistory.sale_date,
                SalesHistory.quantity,
                Forecast.y_pred,
            )
            .join(
                Forecast,
                (SalesHistory.item_id == Forecast.item_id)
                & (SalesHistory.store_id == Forecast.store_id)
                & (SalesHistory.sale_date == Forecast.forecast_date)
                & ((Forecast.model_version != "fast-inference-sba") | (Forecast.model_version.is_(None))),
            )
            .filter(
                SalesHistory.item_id == item_id,
                SalesHistory.store_id == store_id,
                SalesHistory.sale_date <= cutoff_date,
            )
            .order_by(SalesHistory.sale_date.asc())
            .all()
        )

        if len(merged_query) < horizon_days:
            return np.array([])

        df = pd.DataFrame(merged_query, columns=["sale_date", "quantity", "y_pred"])
        df["quantity"] = pd.to_numeric(df["quantity"], errors="coerce").dropna()
        df["y_pred"] = pd.to_numeric(df["y_pred"], errors="coerce").dropna()
        df = df.dropna(subset=["quantity", "y_pred"])

        if len(df) < horizon_days:
            return np.array([])

        # Tổng nhu cầu thực tế và tổng dự báo trượt trên cửa sổ bảo vệ H ngày
        rolling_actual = df["quantity"].rolling(window=horizon_days).sum().dropna().values
        rolling_pred = df["y_pred"].rolling(window=horizon_days).sum().dropna().values

        if len(rolling_actual) < 3:
            return np.array([])

        # Sai số dự báo thực nghiệm r(H) = D(H) - F_hat(H)
        residuals = rolling_actual - rolling_pred
        return residuals[-max_origins:]

    def calculate_quantiles_dict(
        self,
        point_window: float,
        residuals: np.ndarray,
        tau_levels: Optional[List[float]] = None,
        quantile_floor: float = 1.0,
    ) -> Dict[str, float]:
        """
        Tính toán giá trị quantile cho toàn bộ các mức tau:
        - Sử dụng Percentile thực nghiệm nếu có >= 5 mẫu sai số.
        - Fallback Gaussian nếu ít mẫu lịch sử.
        - Áp dụng Quantile Floor cho các mức tau >= 0.90.
        """
        levels = tau_levels or ROUTE_C_TAU_LEVELS
        q_dict: Dict[str, float] = {}

        has_empirical = len(residuals) >= 5

        if has_empirical:
            for tau in levels:
                pct = tau * 100.0
                err_val = float(np.percentile(residuals, pct))
                q_val = max(0.0, point_window + err_val)

                if tau >= 0.90 and point_window > 0:
                    q_val = max(q_val, quantile_floor)

                q_dict[str(tau)] = round(q_val, 2)
        else:
            # Gaussian fallback
            sigma_h = max(0.5, point_window * 0.25)
            for tau in levels:
                z = GAUSSIAN_Z.get(tau, 1.645)
                q_val = max(0.0, point_window + z * sigma_h)

                if tau >= 0.90 and point_window > 0:
                    q_val = max(q_val, quantile_floor)

                q_dict[str(tau)] = round(q_val, 2)

        return q_dict

    def get_or_create_window_quantile(
        self,
        db: Session,
        store_id: str,
        item_id: str,
        origin_date: date,
        horizon_days: int = 10,
        model_run_id: str = "backtest-ensemble-v1",
    ) -> ForecastWindowQuantile:
        """
        Lấy bản ghi phân phối cửa sổ đã lưu hoặc tính toán mới và lưu vào bảng forecast_window_quantile.
        """
        record_id = f"{model_run_id}_{store_id}_{item_id}_{origin_date}_{horizon_days}"

        existing = db.query(ForecastWindowQuantile).filter(ForecastWindowQuantile.id == record_id).first()
        if existing:
            return existing

        # Tìm theo store_id, item_id, origin_date nếu khác horizon
        existing_any = (
            db.query(ForecastWindowQuantile)
            .filter(
                ForecastWindowQuantile.store_id == store_id,
                ForecastWindowQuantile.item_id == item_id,
                ForecastWindowQuantile.origin_date == origin_date,
            )
            .first()
        )
        if existing_any:
            return existing_any

        # Tính toán F_hat(H) và residuals
        point_window = self.compute_point_window_forecast(db, item_id, store_id, origin_date, horizon_days)
        residuals = self.collect_historical_residuals(db, item_id, store_id, origin_date, horizon_days)
        q_levels = self.calculate_quantiles_dict(point_window, residuals, ROUTE_C_TAU_LEVELS, quantile_floor=1.0)

        record = ForecastWindowQuantile(
            id=record_id,
            model_run_id=model_run_id,
            store_id=store_id,
            item_id=item_id,
            origin_date=origin_date,
            horizon_days=horizon_days,
            point_window=point_window,
            q_levels=q_levels,
            route="c",
            created_at=datetime.now(timezone.utc),
        )

        try:
            db.add(record)
            db.commit()
            db.refresh(record)
            return record
        except Exception:
            db.rollback()
            existing = db.query(ForecastWindowQuantile).filter(ForecastWindowQuantile.id == record_id).first()
            if existing:
                return existing
            raise

    def get_tau_quantile_value(
        self,
        db: Session,
        store_id: str,
        item_id: str,
        origin_date: date,
        tau: float = 0.95,
        horizon_days: int = 10,
        model_run_id: str = "backtest-ensemble-v1",
    ) -> float:
        """
        Lấy trực tiếp giá trị Q_hat(tau) (mặc định tau=0.95) phục vụ công thức đặt hàng Tier 2:
        s = ceil( Q_hat(0.95) * exp(m_g + theta_g) )
        """
        record = self.get_or_create_window_quantile(
            db, store_id, item_id, origin_date, horizon_days, model_run_id
        )
        q_dict = record.q_levels or {}
        tau_str = str(tau)

        if tau_str in q_dict:
            return float(q_dict[tau_str])

        # Nếu không có key chính xác, tìm mức gần nhất
        available_taus = [float(k) for k in q_dict.keys()]
        if available_taus:
            closest_tau = min(available_taus, key=lambda x: abs(x - tau))
            return float(q_dict[str(closest_tau)])

        return float(round(record.point_window * 1.5, 2))


window_quantile_service = WindowQuantileService()

