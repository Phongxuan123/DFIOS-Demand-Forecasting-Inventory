from app.repositories.base_repository import BaseRepository
from app.repositories.user_repository import UserRepository, user_repository
from app.repositories.product_repository import ProductRepository, product_repository
from app.repositories.supplier_repository import SupplierRepository, supplier_repository
from app.repositories.inventory_repository import InventoryRepository, inventory_repository
from app.repositories.sales_repository import SalesRepository, sales_repository
from app.repositories.event_repository import EventRepository, event_repository
from app.repositories.system_setting_repository import SystemSettingRepository, system_setting_repository
from app.repositories.forecast_repository import ForecastRepository, forecast_repository

__all__ = [
    "BaseRepository",
    "UserRepository",
    "user_repository",
    "ProductRepository",
    "product_repository",
    "SupplierRepository",
    "supplier_repository",
    "InventoryRepository",
    "inventory_repository",
    "SalesRepository",
    "sales_repository",
    "EventRepository",
    "event_repository",
    "SystemSettingRepository",
    "system_setting_repository",
    "ForecastRepository",
    "forecast_repository",
]
