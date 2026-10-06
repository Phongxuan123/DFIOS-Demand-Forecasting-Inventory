from app.repositories.base_repository import BaseRepository
from app.repositories.user_repository import UserRepository, user_repository
from app.repositories.product_repository import ProductRepository, product_repository
from app.repositories.supplier_repository import SupplierRepository, supplier_repository
from app.repositories.inventory_repository import InventoryRepository, inventory_repository

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
]
