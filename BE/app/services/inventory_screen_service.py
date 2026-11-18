"""
G-48 - Inventory Management screen (teacher demo.md screen 3, docs/teacher_map/A_docs_and_report.md sec. 5.9).

One row per SKU of ONE store, built only from tables that already exist:

    on_hand, on_order          inventory                       (on_order = units in transit, the pipeline)
    IP = on_hand + on_order    (computed, the inventory position used by the (R, s, S) trigger)
    s, S, safety_stock, eoq    inventory_params                (latest J4 / optimisation run, one row per item/store)
    class                      sku_classifications             (segment AX..CZ of the same store)
    latest recommendation      replenishment_recommendations   (newest row of the SKU in the store)
    mean daily demand          sales_history                   (mean of the days the store has sales rows in the
                                                                DAYS_OF_COVER_WINDOW days before the clock date)
    days of cover              on_hand / mean daily demand     (None when the mean is 0 or unknown)
    stock status               below_s  if IP <  s  (strict, the replenishment trigger, G-02)
                               above_S  if IP >  S
                               ok       otherwise
                               no_params when the SKU has no s (no inventory_params row)
    cold_start                 the SKU has no forecast-backed data (no Ensemble forecast, no backtest forecast, no
                               imported teacher window quantile) - the same test J4 uses to pick the ML path

Filtering (class, status, search), sorting and pagination are done in SQL (server-side).
Read-only: nothing here writes to the database.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import List, Optional

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy import and_, case, distinct, func, literal, or_, select
from sqlalchemy.orm import Session

from app.models.classification import SKUClassification
from app.models.inventory import Inventory
from app.models.inventory_param import InventoryParam
from app.models.product import Product
from app.models.replenishment import ReplenishmentRecommendation
from app.models.sales_history import SalesHistory
from app.models.sim_clock import SimClock
from app.services import policy_config as pc

DAYS_OF_COVER_WINDOW: int = 28

STATUS_BELOW_S = "below_s"
STATUS_OK = "ok"
STATUS_ABOVE_S = "above_S"
STATUS_NO_PARAMS = "no_params"
ALL_STATUSES = (STATUS_BELOW_S, STATUS_OK, STATUS_ABOVE_S, STATUS_NO_PARAMS)

SORT_KEYS = (
    "item_id", "name", "segment", "on_hand", "on_order", "ip", "s", "S", "days_of_cover", "status",
    "stock_value", "price",
)


class LatestRecommendation(BaseModel):
    id: str
    status: str
    recommended_qty: float
    final_qty: float
    review_date: Optional[date] = None
    policy_applied: Optional[str] = None


class InventoryScreenRow(BaseModel):
    item_id: str
    name: Optional[str] = None
    cat_id: Optional[str] = None
    price: Optional[float] = None
    segment: Optional[str] = None
    abc_class: Optional[str] = None
    xyz_class: Optional[str] = None
    on_hand: float
    on_order: float
    ip: float
    s: Optional[float] = None
    S: Optional[float] = None
    safety_stock: Optional[float] = None
    eoq: Optional[float] = None
    params_source: Optional[str] = None
    params_model_run_id: Optional[str] = None
    mean_daily_demand: Optional[float] = None
    days_of_cover: Optional[float] = None
    stock_status: str
    stock_value: Optional[float] = None
    cold_start: bool = False
    latest_recommendation: Optional[LatestRecommendation] = None


class InventoryScreenSummary(BaseModel):
    sku_count: int
    below_s_count: int
    above_S_count: int
    no_params_count: int
    total_stock_value: float
    priced_sku_count: int
    units_in_transit: float
    skus_in_transit: int
    orders_in_transit: int


class InventoryScreenResponse(BaseModel):
    store_id: str
    as_of: date
    as_of_source: str  # "sim_clock" | "demo_default"
    demand_window_days: int
    demand_days_observed: int
    items: List[InventoryScreenRow]
    total: int
    skip: int
    limit: int
    summary: InventoryScreenSummary
    notes: List[str]


class InventoryScreenService:

    @staticmethod
    def _reject_global(store_id: Optional[str]) -> str:
        sid = (store_id or "").strip()
        if not sid or sid.upper() in ("GLOBAL", "ALL"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Inventory Management cần một cửa hàng cụ thể (store_id khác GLOBAL/ALL).",
            )
        return sid

    @staticmethod
    def _as_of(db: Session, store_id: str) -> tuple[date, str]:
        clock = db.query(SimClock).filter(SimClock.store_id == store_id).first()
        if clock and clock.current_date:
            return clock.current_date, "sim_clock"
        return pc.DEMO_START_DATE, "demo_default"

    def _base(self, db: Session, store_id: str, as_of: date):
        """Labelled SELECT of every column of the screen; filters / sorts are applied on top."""
        lo = as_of - timedelta(days=DAYS_OF_COVER_WINDOW)
        n_days = db.execute(
            select(func.count(distinct(SalesHistory.sale_date))).where(
                SalesHistory.store_id == store_id, SalesHistory.sale_date >= lo, SalesHistory.sale_date < as_of)
        ).scalar() or 0

        demand = (
            select(SalesHistory.item_id.label("d_item"), func.sum(SalesHistory.quantity).label("d_sum"))
            .where(SalesHistory.store_id == store_id, SalesHistory.sale_date >= lo, SalesHistory.sale_date < as_of)
            .group_by(SalesHistory.item_id)
            .subquery()
        )
        rn = func.row_number().over(
            partition_by=ReplenishmentRecommendation.item_id,
            order_by=(ReplenishmentRecommendation.created_at.desc(), ReplenishmentRecommendation.id.desc()),
        ).label("rn")
        rec_ranked = (
            select(
                ReplenishmentRecommendation.item_id.label("r_item"),
                ReplenishmentRecommendation.id.label("r_id"),
                ReplenishmentRecommendation.status.label("r_status"),
                ReplenishmentRecommendation.recommended_qty.label("r_rec"),
                ReplenishmentRecommendation.final_qty.label("r_final"),
                ReplenishmentRecommendation.review_date.label("r_review"),
                ReplenishmentRecommendation.policy_applied.label("r_policy"),
                rn,
            )
            .where(ReplenishmentRecommendation.store_id == store_id)
            .subquery()
        )
        rec = select(rec_ranked).where(rec_ranked.c.rn == 1).subquery()

        ip = (Inventory.on_hand + Inventory.on_order).label("ip")
        s_col = InventoryParam.s
        S_col = InventoryParam.S
        stock_status = case(
            (s_col.is_(None), literal(STATUS_NO_PARAMS)),
            ((Inventory.on_hand + Inventory.on_order) < s_col, literal(STATUS_BELOW_S)),
            (and_(S_col.is_not(None), (Inventory.on_hand + Inventory.on_order) > S_col), literal(STATUS_ABOVE_S)),
            else_=literal(STATUS_OK),
        ).label("stock_status")
        if n_days > 0:
            mean_daily = (func.coalesce(demand.c.d_sum, 0.0) / float(n_days)).label("mean_daily")
            cover = case(
                (func.coalesce(demand.c.d_sum, 0.0) > 0, Inventory.on_hand / (func.coalesce(demand.c.d_sum, 0.0) / float(n_days))),
                else_=None,
            ).label("days_of_cover")
        else:  # no sales row at all in the window: demand is unknown, never 0
            mean_daily = literal(None).label("mean_daily")
            cover = literal(None).label("days_of_cover")
        stock_value = (Inventory.on_hand * Product.price).label("stock_value")

        q = (
            select(
                Inventory.item_id, Product.name, Product.cat_id, Product.price,
                SKUClassification.segment, SKUClassification.abc_class, SKUClassification.xyz_class,
                Inventory.on_hand, Inventory.on_order, ip,
                s_col.label("s"), S_col.label("S_up"), InventoryParam.safety_stock, InventoryParam.eoq,
                InventoryParam.source.label("p_source"), InventoryParam.model_run_id.label("p_run"),
                mean_daily, cover, stock_status, stock_value,
                rec.c.r_id, rec.c.r_status, rec.c.r_rec, rec.c.r_final, rec.c.r_review, rec.c.r_policy,
            )
            .select_from(Inventory)
            .outerjoin(Product, Product.item_id == Inventory.item_id)
            .outerjoin(InventoryParam, and_(InventoryParam.item_id == Inventory.item_id,
                                            InventoryParam.store_id == Inventory.store_id))
            .outerjoin(SKUClassification, and_(SKUClassification.item_id == Inventory.item_id,
                                               SKUClassification.store_id == Inventory.store_id))
            .outerjoin(demand, demand.c.d_item == Inventory.item_id)
            .outerjoin(rec, rec.c.r_item == Inventory.item_id)
            .where(Inventory.store_id == store_id)
        )
        cols = {
            "item_id": Inventory.item_id, "name": Product.name, "segment": SKUClassification.segment,
            "on_hand": Inventory.on_hand, "on_order": Inventory.on_order,
            "ip": Inventory.on_hand + Inventory.on_order, "s": s_col, "S": S_col, "days_of_cover": cover,
            "status": stock_status, "stock_value": stock_value, "price": Product.price,
        }
        return q, cols, int(n_days)

    @staticmethod
    def _cold_start_items(db: Session, store_id: str, item_ids: List[str]) -> set:
        if not item_ids:
            return set()
        from app.services.optimization_service import optimization_service  # read-only helper (J4 ML-path test)
        backed = optimization_service._forecast_backed_items(db, store_id, item_ids)
        return set(item_ids) - set(backed)

    def summary(self, db: Session, store_id: str) -> InventoryScreenSummary:
        ip = Inventory.on_hand + Inventory.on_order
        row = db.execute(
            select(
                func.count(Inventory.item_id),
                func.sum(case((and_(InventoryParam.s.is_not(None), ip < InventoryParam.s), 1), else_=0)),
                func.sum(case((and_(InventoryParam.s.is_not(None), InventoryParam.S.is_not(None),
                                    ip >= InventoryParam.s, ip > InventoryParam.S), 1), else_=0)),
                func.sum(case((InventoryParam.s.is_(None), 1), else_=0)),
                func.coalesce(func.sum(Inventory.on_hand * Product.price), 0.0),
                func.sum(case((Product.price.is_not(None), 1), else_=0)),
                func.coalesce(func.sum(Inventory.on_order), 0.0),
                func.sum(case((Inventory.on_order > 0, 1), else_=0)),
            )
            .select_from(Inventory)
            .outerjoin(Product, Product.item_id == Inventory.item_id)
            .outerjoin(InventoryParam, and_(InventoryParam.item_id == Inventory.item_id,
                                            InventoryParam.store_id == Inventory.store_id))
            .where(Inventory.store_id == store_id)
        ).one()
        orders = db.execute(
            select(func.count(ReplenishmentRecommendation.id)).where(
                ReplenishmentRecommendation.store_id == store_id,
                ReplenishmentRecommendation.status == "APPROVED",
            )
        ).scalar() or 0
        return InventoryScreenSummary(
            sku_count=int(row[0] or 0),
            below_s_count=int(row[1] or 0),
            above_S_count=int(row[2] or 0),
            no_params_count=int(row[3] or 0),
            total_stock_value=round(float(row[4] or 0.0), 2),
            priced_sku_count=int(row[5] or 0),
            units_in_transit=round(float(row[6] or 0.0), 2),
            skus_in_transit=int(row[7] or 0),
            orders_in_transit=int(orders),
        )

    def list_screen(
        self,
        db: Session,
        store_id: Optional[str],
        skip: int = 0,
        limit: int = 50,
        search: Optional[str] = None,
        cls: Optional[str] = None,
        stock_status: Optional[str] = None,
        sort_by: Optional[str] = None,
        sort_dir: str = "asc",
    ) -> InventoryScreenResponse:
        sid = self._reject_global(store_id)
        if stock_status and stock_status not in ALL_STATUSES:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                                detail=f"status phải là một trong {', '.join(ALL_STATUSES)}.")
        if sort_by and sort_by not in SORT_KEYS:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                                detail=f"sort_by phải là một trong {', '.join(SORT_KEYS)}.")
        as_of, as_of_source = self._as_of(db, sid)
        q, cols, n_days = self._base(db, sid, as_of)

        if search and search.strip():
            pat = f"%{search.strip()}%"
            q = q.where(or_(Inventory.item_id.ilike(pat), Product.name.ilike(pat)))
        if cls and cls.strip():
            c = cls.strip().upper()
            if len(c) == 1 and c in "ABC":
                q = q.where(SKUClassification.abc_class == c)
            elif len(c) == 1 and c in "XYZ":
                q = q.where(SKUClassification.xyz_class == c)
            elif c in pc.ALL_CLASSES:
                q = q.where(SKUClassification.segment == c)
            elif c == "NONE":
                q = q.where(SKUClassification.segment.is_(None))
            else:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                                    detail="class phải là A/B/C, X/Y/Z, một nhóm AX..CZ hoặc NONE.")
        if stock_status:
            q = q.where(cols["status"] == stock_status)

        total = db.execute(select(func.count()).select_from(q.subquery())).scalar() or 0

        key = sort_by or "item_id"
        expr = cols[key]
        desc = (sort_dir or "asc").lower() == "desc"
        # NULLs always last (no NULLS LAST dependency: an explicit "is null" key first)
        order = [case((expr.is_(None), 1), else_=0), expr.desc() if desc else expr.asc(), Inventory.item_id.asc()]
        rows = db.execute(q.order_by(*order).offset(skip).limit(limit)).all()

        cold = self._cold_start_items(db, sid, [r.item_id for r in rows])
        items: List[InventoryScreenRow] = []
        for r in rows:
            latest = None
            if r.r_id is not None:
                latest = LatestRecommendation(
                    id=r.r_id, status=r.r_status, recommended_qty=float(r.r_rec or 0.0),
                    final_qty=float(r.r_final or 0.0), review_date=r.r_review, policy_applied=r.r_policy,
                )
            items.append(InventoryScreenRow(
                item_id=r.item_id, name=r.name, cat_id=r.cat_id,
                price=float(r.price) if r.price is not None else None,
                segment=r.segment, abc_class=r.abc_class, xyz_class=r.xyz_class,
                on_hand=float(r.on_hand or 0.0), on_order=float(r.on_order or 0.0), ip=float(r.ip or 0.0),
                s=float(r.s) if r.s is not None else None, S=float(r.S_up) if r.S_up is not None else None,
                safety_stock=float(r.safety_stock) if r.s is not None and r.safety_stock is not None else None,
                eoq=float(r.eoq) if r.s is not None and r.eoq is not None else None,
                params_source=r.p_source, params_model_run_id=r.p_run,
                mean_daily_demand=round(float(r.mean_daily), 4) if r.mean_daily is not None else None,
                days_of_cover=round(float(r.days_of_cover), 2) if r.days_of_cover is not None else None,
                stock_status=r.stock_status,
                stock_value=round(float(r.stock_value), 2) if r.stock_value is not None else None,
                cold_start=r.item_id in cold,
                latest_recommendation=latest,
            ))

        notes = [
            "safety_stock = s - mean_56 * L as stored by the optimisation run (teacher shows s - D_hat_{L+R}; G-44).",
            "stock value uses products.price (one current price per SKU; no price history table).",
            "orders_in_transit = APPROVED replenishment rows of the store (they become COMPLETED on arrival, L days "
            "after review); units_in_transit = sum of inventory.on_order.",
        ]
        if n_days == 0:
            notes.append(f"No sales_history row in the {DAYS_OF_COVER_WINDOW} days before {as_of}: days of cover "
                         "cannot be computed.")
        return InventoryScreenResponse(
            store_id=sid, as_of=as_of, as_of_source=as_of_source,
            demand_window_days=DAYS_OF_COVER_WINDOW, demand_days_observed=n_days,
            items=items, total=int(total), skip=skip, limit=limit,
            summary=self.summary(db, sid), notes=notes,
        )


inventory_screen_service = InventoryScreenService()
