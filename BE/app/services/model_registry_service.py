from typing import Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.model_registry import ModelRegistry
from app.schemas.model_registry import (
    ModelRegisterRequest,
    ModelRegistryResponse,
    ModelPromoteResponse,
    ModelRegistryListResponse,
)
from app.repositories.model_registry_repository import model_registry_repository
from app.services.audit_service import audit_service


class ModelRegistryService:
    """
    Dịch vụ quản lý kho phiên bản mô hình ML và thăng hạng Production (UC48).
    """

    def register_model(
        self,
        db: Session,
        request: ModelRegisterRequest,
        admin_email: Optional[str] = None,
    ) -> ModelRegistryResponse:
        clean_scope = request.scope.strip()
        if request.is_production:
            # Hạ cấp toàn bộ mô hình production cũ cùng scope (B-03)
            old_prods = (
                db.query(ModelRegistry)
                .filter(ModelRegistry.scope == clean_scope, ModelRegistry.is_production == True)
                .all()
            )
            for old in old_prods:
                old.is_production = False

        model = ModelRegistry(
            name=request.name.strip(),
            version=request.version.strip(),
            algorithm=request.algorithm.lower().strip(),
            scope=clean_scope,
            is_production=request.is_production,
            parameters=request.parameters,
            metrics=request.metrics,
            trained_by=admin_email,
            job_id=request.job_id,
        )
        saved = model_registry_repository.create(db, model)

        audit_service.log(
            db,
            action="ml.model.register",
            actor_email=admin_email,
            details=f"Đăng ký phiên bản mô hình '{saved.name}' v{saved.version} ({saved.algorithm}) vào Model Registry.",
        )
        db.commit()
        return ModelRegistryResponse.model_validate(saved)

    def promote_model(
        self,
        db: Session,
        model_id: str,
        admin_email: Optional[str] = None,
    ) -> ModelPromoteResponse:
        promoted, demoted_id = model_registry_repository.promote_model(db, model_id=model_id)
        if not promoted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy phiên bản mô hình với ID: {model_id}",
            )

        details_msg = (
            f"Thăng hạng mô hình '{promoted.name}' v{promoted.version} (ID {promoted.id}) làm Production cho scope '{promoted.scope}'."
        )
        if demoted_id:
            details_msg += f" Đã tự động hạ cấp phiên bản cũ ID {demoted_id}."

        audit_service.log(
            db,
            action="ml.model.promote",
            actor_email=admin_email,
            details=details_msg,
        )
        db.commit()

        return ModelPromoteResponse(
            promoted_model=ModelRegistryResponse.model_validate(promoted),
            demoted_model_id=demoted_id,
            message=f"Đã thăng hạng thành công mô hình '{promoted.name}' v{promoted.version} làm Production.",
        )

    def get_model(self, db: Session, model_id: str) -> ModelRegistryResponse:
        model = model_registry_repository.get_by_id(db, model_id=model_id)
        if not model:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy phiên bản mô hình với ID: {model_id}",
            )
        return ModelRegistryResponse.model_validate(model)

    def list_models(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 20,
        is_production: Optional[bool] = None,
        algorithm: Optional[str] = None,
        scope: Optional[str] = None,
    ) -> ModelRegistryListResponse:
        items, total = model_registry_repository.list_models(
            db,
            skip=skip,
            limit=limit,
            is_production=is_production,
            algorithm=algorithm,
            scope=scope,
        )
        return ModelRegistryListResponse(
            items=[ModelRegistryResponse.model_validate(m) for m in items],
            total=total,
        )


model_registry_service = ModelRegistryService()
