from app.services.auth_service import AuthService, auth_service
from app.services.user_service import UserService, user_service
from app.services.product_service import ProductService, product_service
from app.services.supplier_service import SupplierService, supplier_service
from app.services.inventory_service import InventoryService, inventory_service
from app.services.sales_service import SalesService, sales_service
from app.services.event_calendar_service import EventCalendarService, event_calendar_service

__all__ = [
    "AuthService",
    "auth_service",
    "UserService",
    "user_service",
    "ProductService",
    "product_service",
    "SupplierService",
    "supplier_service",
    "InventoryService",
    "inventory_service",
    "SalesService",
    "sales_service",
    "EventCalendarService",
    "event_calendar_service",
]
