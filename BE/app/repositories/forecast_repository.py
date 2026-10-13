from datetime import date
from typing import Dict, List, Optional, Tuple, Any
from sqlalchemy.orm import Session
from sqlalchemy import desc, asc

from app.models.forecast import Forecast, ForecastSigma, ForecastOverride, ForecastExplanation
from app.models.product import Product
from app.models.sales_history import SalesHistory
from app.repositories.base_repository import BaseRepository


class ForecastRepository(BaseRepository[Forecast]):
    def __init__(self):
        super().__init__(Forecast)

    def get_forecasts(
        self,
        db: Session,
        horizon: int,
        item_id: Optional[str] = None,
        category: Optional[str] = None,
        store_id: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        model_version: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
        sort_by: str = "forecast_date",
        order: str = "asc",
    ) -> Tuple[int, List[Tuple[Forecast, Optional[str], Optional[str]]]]:
        """
        Lấy danh sách dự báo kết hợp thông tin sản phẩm (name, cat_id) và lọc theo horizon h <= horizon.
        Trả về (total, [(Forecast, product_name, cat_id), ...])
        """
        query = db.query(Forecast, Product.name, Product.cat_id).outerjoin(
            Product, Forecast.item_id == Product.item_id
        )

        query = query.filter(Forecast.h <= horizon)

        if item_id:
            query = query.filter(Forecast.item_id == item_id)
        if category:
            query = query.filter(Product.cat_id == category)
        if store_id:
            query = query.filter(Forecast.store_id == store_id)
        if start_date:
            query = query.filter(Forecast.forecast_date >= start_date)
        if end_date:
            query = query.filter(Forecast.forecast_date <= end_date)
        if model_version:
            query = query.filter(Forecast.model_version == model_version)

        total = query.count()

        # Sắp xếp
        sort_column = Forecast.forecast_date
        if sort_by == "item_id":
            sort_column = Forecast.item_id
        elif sort_by == "y_pred":
            sort_column = Forecast.y_pred
        elif sort_by == "h":
            sort_column = Forecast.h

        if order.lower() == "desc":
            query = query.order_by(desc(sort_column), desc(Forecast.h))
        else:
            query = query.order_by(asc(sort_column), asc(Forecast.h))

        results = query.offset(skip).limit(limit).all()
        return total, results

    def get_single_forecast(
        self,
        db: Session,
        item_id: str,
        forecast_date: date,
        store_id: Optional[str] = None,
        h: Optional[int] = None,
    ) -> Optional[Forecast]:
        query = db.query(Forecast).filter(
            Forecast.item_id == item_id,
            Forecast.forecast_date == forecast_date,
        )
        if store_id:
            query = query.filter(Forecast.store_id == store_id)
        if h is not None:
            query = query.filter(Forecast.h == h)
        return query.first()

    def get_latest_model_version(self, db: Session) -> Optional[str]:
        latest = db.query(Forecast.model_version).order_by(desc(Forecast.generated_at)).first()
        return latest[0] if latest else None

    # --- Override methods ---

    def get_active_overrides_dict(
        self,
        db: Session,
        item_id: Optional[str] = None,
        store_id: Optional[str] = None,
    ) -> Dict[str, ForecastOverride]:
        """
        Lấy danh sách override đang hoạt động dưới dạng dict key: f"{item_id}_{store_id}_{forecast_date}"
        """
        query = db.query(ForecastOverride).filter(ForecastOverride.is_active.is_(True))
        if item_id:
            query = query.filter(ForecastOverride.item_id == item_id)
        if store_id:
            query = query.filter(ForecastOverride.store_id == store_id)
        overrides = query.all()

        override_dict: Dict[str, ForecastOverride] = {}
        for ov in overrides:
            key = f"{ov.item_id}_{ov.store_id}_{ov.forecast_date}"
            override_dict[key] = ov
        return override_dict

    def get_override_by_id(self, db: Session, override_id: str) -> Optional[ForecastOverride]:
        return db.query(ForecastOverride).filter(ForecastOverride.id == override_id).first()

    def create_override(self, db: Session, override: ForecastOverride) -> ForecastOverride:
        # Nếu đã có override cũ cho cùng item, store, forecast_date đang active thì vô hiệu hóa bản cũ
        existing = (
            db.query(ForecastOverride)
            .filter(
                ForecastOverride.item_id == override.item_id,
                ForecastOverride.store_id == override.store_id,
                ForecastOverride.forecast_date == override.forecast_date,
                ForecastOverride.is_active.is_(True),
            )
            .all()
        )
        for old in existing:
            old.is_active = False

        db.add(override)
        db.commit()
        db.refresh(override)
        return override

    def deactivate_override(self, db: Session, override: ForecastOverride) -> ForecastOverride:
        override.is_active = False
        db.commit()
        db.refresh(override)
        return override

    def get_overrides_for_sku(
        self,
        db: Session,
        item_id: str,
        store_id: Optional[str] = None,
    ) -> List[ForecastOverride]:
        query = db.query(ForecastOverride).filter(ForecastOverride.item_id == item_id)
        if store_id:
            query = query.filter(ForecastOverride.store_id == store_id)
        return query.order_by(desc(ForecastOverride.created_at)).all()

    # --- Historical & Uncertainty methods ---

    def get_historical_sales(
        self,
        db: Session,
        item_id: str,
        store_id: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> List[SalesHistory]:
        query = db.query(SalesHistory).filter(SalesHistory.item_id == item_id)
        if store_id:
            query = query.filter(SalesHistory.store_id == store_id)
        if start_date:
            query = query.filter(SalesHistory.sale_date >= start_date)
        if end_date:
            query = query.filter(SalesHistory.sale_date <= end_date)
        return query.order_by(asc(SalesHistory.sale_date)).all()

    def get_forecasts_for_sku(
        self,
        db: Session,
        item_id: str,
        store_id: Optional[str] = None,
        horizon: Optional[int] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> List[Forecast]:
        query = db.query(Forecast).filter(Forecast.item_id == item_id)
        if store_id:
            query = query.filter(Forecast.store_id == store_id)
        if horizon is not None:
            query = query.filter(Forecast.h <= horizon)
        if start_date:
            query = query.filter(Forecast.forecast_date >= start_date)
        if end_date:
            query = query.filter(Forecast.forecast_date <= end_date)
        return query.order_by(asc(Forecast.forecast_date), asc(Forecast.h)).all()

    def get_sigma(self, db: Session, item_id: str) -> Optional[ForecastSigma]:
        return db.query(ForecastSigma).filter(ForecastSigma.id == item_id).first()

    # --- Explanations (SHAP) ---

    def get_explanations(
        self,
        db: Session,
        item_id: str,
        store_id: Optional[str] = None,
        model_version: Optional[str] = None,
    ) -> List[ForecastExplanation]:
        query = db.query(ForecastExplanation).filter(ForecastExplanation.item_id == item_id)
        if store_id:
            query = query.filter(ForecastExplanation.store_id == store_id)
        if model_version:
            query = query.filter(ForecastExplanation.model_version == model_version)
        return query.order_by(desc(ForecastExplanation.importance_score)).all()

    def add_explanation(self, db: Session, exp: ForecastExplanation) -> ForecastExplanation:
        db.add(exp)
        db.commit()
        db.refresh(exp)
        return exp


forecast_repository = ForecastRepository()
