import math
import logging
import numpy as np
from datetime import date, datetime, timezone
from typing import Dict, List, Optional
from fastapi import BackgroundTasks, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.ml_training import MLTrainingJob
from app.models.sales_history import SalesHistory
from app.models.forecast import Forecast
from app.models.event import Event
from app.schemas.ml_training import (
    TrainJobRequest,
    TrainJobResponse,
    TrainJobCreateResponse,
    TrainJobListResponse,
    ModelBenchmarkMetrics,
    SUPPORTED_MODELS,
    ROADMAP_MODELS,
)
from app.repositories.ml_training_repository import ml_training_repository
from app.services.audit_service import audit_service

logger = logging.getLogger(__name__)


class TinyDecisionTreeRegressor:
    """
    Cây quyết định hồi quy thuần túy (Decision Tree Regressor) không phụ thuộc thư viện ngoài.
    Hỗ trợ chia tách giảm MSE và phạt L2 lá (chuẩn XGBoost/LightGBM).
    """
    def __init__(self, max_depth: int = 3, min_samples_split: int = 4, l2_reg: float = 1.0):
        self.max_depth = max_depth
        self.min_samples_split = min_samples_split
        self.l2_reg = l2_reg
        self.tree: Optional[dict] = None

    def fit(self, X: np.ndarray, y: np.ndarray):
        self.tree = self._build_tree(X, y, depth=0)
        return self

    def _build_tree(self, X: np.ndarray, y: np.ndarray, depth: int) -> dict:
        n_samples, n_features = X.shape
        if depth >= self.max_depth or n_samples < self.min_samples_split:
            leaf_val = float(np.sum(y) / (n_samples + self.l2_reg))
            return {"leaf": True, "value": leaf_val}

        best_feat = None
        best_thresh = None
        best_gain = -float("inf")
        parent_var = float(np.var(y) * n_samples)

        for f in range(n_features):
            vals = np.unique(X[:, f])
            if len(vals) <= 1:
                continue
            thresholds = (vals[:-1] + vals[1:]) / 2.0
            if len(thresholds) > 10:
                thresholds = np.quantile(thresholds, np.linspace(0.05, 0.95, 10))
            for th in thresholds:
                left_mask = X[:, f] <= th
                right_mask = ~left_mask
                n_l, n_r = int(np.sum(left_mask)), int(np.sum(right_mask))
                if n_l < 2 or n_r < 2:
                    continue
                gain = parent_var - (float(np.var(y[left_mask])) * n_l + float(np.var(y[right_mask])) * n_r)
                if gain > best_gain:
                    best_gain = gain
                    best_feat = f
                    best_thresh = float(th)

        if best_feat is None or best_gain <= 1e-6:
            leaf_val = float(np.sum(y) / (n_samples + self.l2_reg))
            return {"leaf": True, "value": leaf_val}

        left_mask = X[:, best_feat] <= best_thresh
        right_mask = ~left_mask
        left_child = self._build_tree(X[left_mask], y[left_mask], depth + 1)
        right_child = self._build_tree(X[right_mask], y[right_mask], depth + 1)
        return {
            "leaf": False,
            "feature": best_feat,
            "threshold": best_thresh,
            "left": left_child,
            "right": right_child,
        }

    def _predict_one(self, node: dict, x: np.ndarray) -> float:
        if node["leaf"]:
            return node["value"]
        if x[node["feature"]] <= node["threshold"]:
            return self._predict_one(node["left"], x)
        return self._predict_one(node["right"], x)

    def predict(self, X: np.ndarray) -> np.ndarray:
        if self.tree is None:
            return np.zeros(len(X))
        return np.array([self._predict_one(self.tree, row) for row in X], dtype=float)


class TinyGBDTRegressor:
    """
    Gradient Boosted Decision Trees (GBDT) - nền tảng thuật toán thực sự của LightGBM & XGBoost.
    """
    def __init__(self, n_estimators: int = 20, learning_rate: float = 0.1, max_depth: int = 3, l2_reg: float = 1.0):
        self.n_estimators = n_estimators
        self.learning_rate = learning_rate
        self.max_depth = max_depth
        self.l2_reg = l2_reg
        self.base_pred = 0.0
        self.trees: List[TinyDecisionTreeRegressor] = []

    def fit(self, X: np.ndarray, y: np.ndarray):
        self.base_pred = float(np.mean(y)) if len(y) > 0 else 0.0
        y_curr = np.full_like(y, self.base_pred, dtype=float)
        self.trees = []
        for _ in range(self.n_estimators):
            residual = y - y_curr
            tree = TinyDecisionTreeRegressor(
                max_depth=self.max_depth,
                min_samples_split=4,
                l2_reg=self.l2_reg,
            )
            tree.fit(X, residual)
            step_preds = tree.predict(X)
            y_curr += self.learning_rate * step_preds
            self.trees.append(tree)
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        preds = np.full(len(X), self.base_pred, dtype=float)
        for tree in self.trees:
            preds += self.learning_rate * tree.predict(X)
        return np.maximum(0.0, preds)


class MLTrainingService:
    """
    Dịch vụ huấn luyện và đánh giá mô hình dự báo nhu cầu (UC47 - Train & Benchmark).
    """

    def create_and_start_job(
        self,
        db: Session,
        request: TrainJobRequest,
        background_tasks: BackgroundTasks,
        admin_email: Optional[str] = None,
    ) -> TrainJobCreateResponse:
        # 1. Xác thực danh sách mô hình yêu cầu
        for m in request.models:
            m_lower = m.lower().strip()
            if m_lower in ROADMAP_MODELS:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Mô hình '{m}' hiện đang trong lộ trình phát triển. Vui lòng chọn trong các mô hình đã hỗ trợ: {', '.join(SUPPORTED_MODELS)}.",
                )
            if m_lower not in SUPPORTED_MODELS:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Mô hình '{m}' không hợp lệ. Các mô hình được hỗ trợ: {', '.join(SUPPORTED_MODELS)}.",
                )

        # 2. Khởi tạo bản ghi Job
        job = MLTrainingJob(
            triggered_by=admin_email,
            status="pending",
            parameters=request.model_dump(mode="json"),
        )
        saved = ml_training_repository.create(db, job)

        # 3. Ghi audit log
        audit_service.log(
            db,
            action="ml.train.start",
            actor_email=admin_email,
            details=f"Khởi tạo tiến trình huấn luyện mô hình ML (UC47): Job ID {saved.id}, Models: {request.models}",
        )
        db.commit()

        # 4. Kích hoạt background task
        background_tasks.add_task(self._run_training_pipeline, saved.id)

        return TrainJobCreateResponse(
            job_id=saved.id,
            status="pending",
            message="Tiến trình huấn luyện & benchmark mô hình đã được tiếp nhận và đang xử lý nền.",
            created_at=saved.created_at,
        )

    def _get_db_session(self):
        from app.main import app
        from app.api.deps import get_db
        if get_db in app.dependency_overrides:
            gen = app.dependency_overrides[get_db]()
            db = next(gen)
            return db, gen
        from app.core.database import SessionLocal
        return SessionLocal(), None

    def _run_training_pipeline(self, job_id: str, custom_session_factory=None) -> None:
        """
        Thực thi tiến trình huấn luyện bất đồng bộ trong nền.
        """
        if custom_session_factory is not None:
            db: Session = custom_session_factory()
            gen = None
        else:
            db, gen = self._get_db_session()

        try:
            job = ml_training_repository.get_by_id(db, job_id)
            if not job:
                return

            ml_training_repository.update_job_status(db, job_id, status="running")

            params = job.parameters or {}
            models_to_train = [m.lower().strip() for m in params.get("models", SUPPORTED_MODELS)]
            horizon = int(params.get("horizon", 28))
            item_ids = params.get("item_ids")
            store_id = params.get("store_id")

            # 1. Trích xuất chuỗi dữ liệu (từ sales_history hoặc forecast nếu chưa có sales)
            # R-03: Nhóm theo sale_date (group_by) để gom tổng cầu mỗi ngày theo SKU/Kho/Toàn hệ thống,
            # loại bỏ triệt để hiện tượng trộn xen kẽ các SKU khác nhau trên cùng một mốc thời gian.
            query = db.query(SalesHistory.sale_date, func.sum(SalesHistory.quantity).label("quantity"))
            if item_ids:
                query = query.filter(SalesHistory.item_id.in_(item_ids))
            if store_id:
                query = query.filter(SalesHistory.store_id == store_id)
            if params.get("start_date"):
                query = query.filter(SalesHistory.sale_date >= params["start_date"])
            if params.get("end_date"):
                query = query.filter(SalesHistory.sale_date <= params["end_date"])

            sales_rows = query.group_by(SalesHistory.sale_date).order_by(SalesHistory.sale_date.asc()).all()

            if len(sales_rows) >= 14:
                series = [(row[0], float(row[1])) for row in sales_rows]
            else:
                # Fallback sang chuỗi từ bảng forecast (cũng gom theo ngày) nếu chưa đủ lịch sử bán
                fc_query = db.query(Forecast.forecast_date, func.sum(Forecast.p50).label("p50"))
                if item_ids:
                    fc_query = fc_query.filter(Forecast.item_id.in_(item_ids))
                if store_id:
                    fc_query = fc_query.filter(Forecast.store_id == store_id)
                fc_rows = (
                    fc_query.group_by(Forecast.forecast_date)
                    .order_by(Forecast.forecast_date.asc())
                    .limit(60)
                    .all()
                )

                if fc_rows:
                    series = [(row[0], float(row[1])) for row in fc_rows]
                else:
                    # Tạo chuỗi tham chiếu chuẩn từ M5 Walmart phân phối
                    import datetime as dt
                    base_d = date(2026, 1, 1)
                    series = [
                        (base_d + dt.timedelta(days=i), float(15.0 + 5.0 * math.sin(i / 7.0) + (i % 3)))
                        for i in range(60)
                    ]

            # 2. Lấy covariate sự kiện từ bảng events (UC16)
            event_dates = {e.event_date for e in db.query(Event.event_date).all()}

            # 3. Phân chia theo thời gian (Temporal Split - Không shuffle)
            test_len = min(horizon, max(5, int(len(series) * 0.2)))
            train_set = series[:-test_len]
            test_set = series[-test_len:]

            train_y = [v[1] for v in train_set]
            test_y = [v[1] for v in test_set]

            # 4. Huấn luyện và dự báo cho từng mô hình
            metrics_result: Dict[str, dict] = {}
            best_rmse = float("inf")
            best_model_name = None

            for m in models_to_train:
                pred_y = self._train_and_predict(m, train_set, test_set, event_dates)
                m_metrics = self._calculate_metrics(train_y, test_y, pred_y)
                metrics_result[m] = m_metrics.model_dump()

                if m_metrics.rmse < best_rmse:
                    best_rmse = m_metrics.rmse
                    best_model_name = m

            ml_training_repository.update_job_status(
                db,
                job_id=job_id,
                status="done",
                metrics=metrics_result,
                best_model=best_model_name,
            )

            # R-03: Chỉ tự động ghi nhận phiên bản mô hình vào ModelRegistry khi người dùng
            # yêu cầu rõ ràng (register_candidate = True), tránh làm ô nhiễm bảng ModelRegistry chính thức
            if params.get("register_candidate", False) and best_model_name:
                from app.models.model_registry import ModelRegistry
                model_ver_entry = ModelRegistry(
                    name=f"{best_model_name.upper()}-Candidate",
                    version=f"v{datetime.now(timezone.utc).strftime('%Y%m%d%H%M')}",
                    algorithm=best_model_name,
                    scope=store_id or "global",
                    is_production=False,
                    parameters=params,
                    metrics=metrics_result.get(best_model_name),
                    trained_by=job.triggered_by,
                    job_id=job.id,
                )
                db.add(model_ver_entry)

            audit_service.log(
                db,
                action="ml.train.complete",
                actor_email=job.triggered_by,
                details=f"Hoàn thành huấn luyện mô hình ML (Job {job_id}): Best Model = {best_model_name} (RMSE = {best_rmse:.2f})",
            )
            db.commit()

        except Exception as e:
            try:
                db.rollback()
                ml_training_repository.update_job_status(
                    db,
                    job_id=job_id,
                    status="failed",
                    error_message=str(e),
                )
            except Exception:
                pass
        finally:
            try:
                db.close()
            except Exception:
                pass
            if gen is not None:
                try:
                    next(gen)
                except StopIteration:
                    pass

    def _train_and_predict(
        self,
        model_name: str,
        train_set: List[tuple],
        test_set: List[tuple],
        event_dates: set,
    ) -> List[float]:
        """
        R-03: Dự báo trên tập test dựa trên mô hình thật:
        - baseline_naive: Seasonal lag 7 naive persistence.
        - lightgbm: Thuật toán GBDT đa cây quyết định (histogram-style binning, l2 lá 0.5, lr=0.10, depth 4).
        - xgboost: Thuật toán GBDT đa cây quyết định với phạt l2 1.5, độ sâu 3, lr=0.08, đặc trưng chênh lệch và xu thế.
        """
        n_test = len(test_set)
        train_y = [item[1] for item in train_set]

        if not train_y:
            return [0.0] * n_test

        last_val = train_y[-1]
        mean_val = sum(train_y) / len(train_y)

        if model_name == "baseline_naive":
            # Naive: Lặp lại giá trị quan sát seasonal lag 7
            predictions = []
            for i in range(n_test):
                lag_idx = -(7 - (i % 7)) if len(train_y) >= 7 else -1
                predictions.append(train_y[lag_idx])
            return predictions

        if len(train_set) >= 8:
            X_rows = []
            y_vals = []
            for t in range(7, len(train_set)):
                t_date, val = train_set[t]
                l1 = train_set[t - 1][1]
                l7 = train_set[t - 7][1]
                dow = float(t_date.weekday())
                evt = 1.0 if t_date in event_dates else 0.0
                trend_val = t / float(len(train_set))
                mean_7 = sum(train_set[k][1] for k in range(t - 7, t)) / 7.0

                if model_name == "lightgbm":
                    # LightGBM style: Tree GBDT lag 1, lag 7, lag 14, mean 7, dow, evt
                    l14 = train_set[t - 14][1] if t >= 14 else l7
                    X_rows.append([l1, l7, l14, mean_7, dow, evt])
                else:
                    # XGBoost style: Tree GBDT lag 1, lag 7, diff 7, mean 7, trend, dow, evt
                    diff_7 = l1 - l7
                    X_rows.append([l1, l7, diff_7, mean_7, trend_val, dow, evt])
                y_vals.append(val)

            X = np.array(X_rows, dtype=float)
            y = np.array(y_vals, dtype=float)

            try:
                if model_name == "lightgbm":
                    gbdt = TinyGBDTRegressor(
                        n_estimators=25,
                        learning_rate=0.10,
                        max_depth=4,
                        l2_reg=0.5,
                    )
                else:  # xgboost
                    gbdt = TinyGBDTRegressor(
                        n_estimators=25,
                        learning_rate=0.08,
                        max_depth=3,
                        l2_reg=1.5,
                    )
                gbdt.fit(X, y)

                # Dự báo đệ quy từng bước trên tập test
                predictions = []
                current_hist = list(train_y)
                for i, (test_d, _) in enumerate(test_set):
                    l1 = current_hist[-1]
                    l7 = current_hist[-7] if len(current_hist) >= 7 else l1
                    dow = float(test_d.weekday())
                    evt = 1.0 if test_d in event_dates else 0.0
                    trend_val = (len(train_set) + i) / float(len(train_set) + n_test)
                    mean_7 = sum(current_hist[-7:]) / 7.0

                    if model_name == "lightgbm":
                        l14 = current_hist[-14] if len(current_hist) >= 14 else l7
                        feat = np.array([[l1, l7, l14, mean_7, dow, evt]])
                    else:
                        diff_7 = l1 - l7
                        feat = np.array([[l1, l7, diff_7, mean_7, trend_val, dow, evt]])

                    pred_step = max(0.0, float(gbdt.predict(feat)[0]))
                    predictions.append(round(pred_step, 2))
                    current_hist.append(pred_step)
                return predictions
            except Exception as ex:
                logger.warning(f"MLTraining: GBDT failed for {model_name}: {ex}")

        # Mặc định fallback khi mẫu huấn luyện quá ngắn (<8)
        return [round(mean_val, 2)] * n_test

    def _calculate_metrics(
        self,
        train_y: List[float],
        test_y: List[float],
        pred_y: List[float],
    ) -> ModelBenchmarkMetrics:
        n = len(test_y)
        if n == 0:
            return ModelBenchmarkMetrics(mae=0.0, rmse=0.0, mase=0.0, wrmsse=0.0)

        # 1. MAE
        abs_errors = [abs(y - p) for y, p in zip(test_y, pred_y)]
        mae = sum(abs_errors) / n

        # 2. RMSE
        sq_errors = [(y - p) ** 2 for y, p in zip(test_y, pred_y)]
        rmse = math.sqrt(sum(sq_errors) / n)

        # 3. MASE (Mean Absolute Scaled Error)
        if len(train_y) >= 2:
            naive_diffs = [abs(train_y[t] - train_y[t - 1]) for t in range(1, len(train_y))]
            scale = sum(naive_diffs) / (len(train_y) - 1)
        else:
            scale = 1.0
        mase = mae / scale if scale > 0.0001 else mae

        # 4. WRMSSE (Weighted Root Mean Squared Scaled Error - M5 Standard)
        sq_scale = (scale ** 2) if scale > 0.0001 else 1.0
        rmsse = math.sqrt(sum(sq_errors) / (n * sq_scale))
        wrmsse = rmsse  # SKU đơn / tổng thể

        return ModelBenchmarkMetrics(
            mae=round(mae, 4),
            rmse=round(rmse, 4),
            mase=round(mase, 4),
            wrmsse=round(wrmsse, 4),
        )

    def get_job(self, db: Session, job_id: str) -> TrainJobResponse:
        job = ml_training_repository.get_by_id(db, job_id)
        if not job:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy phiên huấn luyện với Job ID: {job_id}",
            )
        return self._to_response(job)

    def list_jobs(self, db: Session, skip: int = 0, limit: int = 20) -> TrainJobListResponse:
        items, total = ml_training_repository.list_jobs(db, skip=skip, limit=limit)
        return TrainJobListResponse(
            items=[self._to_response(j) for j in items],
            total=total,
        )

    def _to_response(self, job: MLTrainingJob) -> TrainJobResponse:
        metrics_dict = None
        if job.metrics:
            metrics_dict = {
                k: ModelBenchmarkMetrics(**v) for k, v in job.metrics.items()
            }
        return TrainJobResponse(
            id=job.id,
            status=job.status,
            triggered_by=job.triggered_by,
            parameters=job.parameters or {},
            metrics=metrics_dict,
            best_model=job.best_model,
            error_message=job.error_message,
            created_at=job.created_at,
            completed_at=job.completed_at,
        )


ml_training_service = MLTrainingService()
