from typing import List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.inventory import Inventory
from app.models.product import Product
from app.schemas.simulation import InsightDetail, PolicySimulationMetric, PolicyComparisonResponse
from app.services import policy_config as pc
from app.services.policy_artifact import (
    ArtifactMissingError,
    ArtifactResults,
    load_results,
)

# policy_id (API) -> artifact key. The labels follow what the artifact rows REALLY are (P-15):
#   B0 = raw quantile tau=0.95 | B2 = raw quantile tau*=0.99 | P-CR = C3-OUT at the critical ratio |
#   P6 = C3-OUT tau=0.95 (service-level controller, not a cost reducer).
POLICY_IDS = [
    ("B0_raw_quantile", "B0"),
    ("B2_frozen_critical_ratio", "B2"),
    ("PCR_c3out_cost_optimal", "PCR"),
    ("P6_c3out_closed_loop", "P6"),
]


class SimulationService:
    """
    What-If policy comparison (Task API.5 / FR10).

    HONESTY RULE (N-01, P-15): this service does NOT simulate the four policies. It returns the
    result rows of the offline M5 run (``c3ok_results.csv``: 25,950 SKUs x 357 test days, L=3, R=7),
    re-scaled to the requested store size / horizon, and says so (``source = "artifact_extract"``,
    ``simulated = False``). If the artifact is missing the endpoint answers 503 - there are no embedded
    constants.
    """

    HOLDING_COST_RATE_PER_DAY = pc.HOLDING_RATE_DAILY
    ORDERING_COST_PER_ORDER = pc.ORDER_COST_C
    STOCKOUT_PENALTY_RATE = pc.STOCKOUT_PENALTY_RATE

    @staticmethod
    def _store_basis(db: Session, store_id: str) -> Tuple[int, Optional[float], str]:
        """(#SKUs of the store, mean unit price, price source). Price = products.price (A3 price)."""
        sku_count = db.query(func.count(Inventory.item_id)).filter(Inventory.store_id == store_id).scalar() or 0
        if sku_count:
            avg_price = (
                db.query(func.avg(Product.price))
                .join(Inventory, Inventory.item_id == Product.item_id)
                .filter(Inventory.store_id == store_id)
                .scalar()
            )
        else:
            sku_count = db.query(func.count(Product.item_id)).scalar() or 0
            avg_price = db.query(func.avg(Product.price)).scalar()
        return int(sku_count), (float(avg_price) if avg_price else None), "products.price"

    def compare_policies(
        self,
        db: Session,
        store_id: str = "CA_1",
        horizon_days: int = 90,
        target_service_level: float = 0.96,
    ) -> PolicyComparisonResponse:
        try:
            art: ArtifactResults = load_results()
        except ArtifactMissingError as e:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))

        sku_count, avg_price, price_source = self._store_basis(db, store_id)
        ref_skus = float(art.n_skus) if art.n_skus else None
        if not ref_skus:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Không xác định được số SKU của artifact (thiếu c3ok_sku_class.csv) nên không thể quy đổi quy mô.",
            )
        if sku_count <= 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Cửa hàng '{store_id}' chưa có SKU/tồn kho nào để quy đổi quy mô mô phỏng.",
            )
        scale = (sku_count / ref_skus) * (horizon_days / float(art.n_days))

        policies: List[PolicySimulationMetric] = []
        for policy_id, key in POLICY_IDS:
            row = art.policies[key]
            hold_cost = round(row.holding_bikip * scale, 2)
            lost_cost = round(row.shortage_bikip * scale, 2)
            ord_cost = round(row.ordering_bikip * scale, 2)
            tot_cost = round(hold_cost + lost_cost + ord_cost, 2)
            total_orders = int(round((row.ordering_bikip / self.ORDERING_COST_PER_ORDER) * scale))
            policies.append(
                PolicySimulationMetric(
                    policy_id=policy_id,
                    policy_key=key,
                    policy_name=row.label,
                    description=row.description,
                    total_cost=tot_cost,
                    holding_cost=hold_cost,
                    ordering_cost=ord_cost,
                    stockout_cost=lost_cost,
                    availability=round(row.csl * 100.0, 1),
                    total_orders=total_orders,
                    total_stockouts=None,
                    stockouts_reason="Số đơn vị thiếu không có trong artifact (chỉ có chi phí b·đơn vị thiếu theo giá từng SKU).",
                    stockouts_reason_code="artifact_no_units",
                    is_feasible=bool(row.csl >= target_service_level),
                    tau=row.tau,
                    csl=round(row.csl, 5),
                    fill_rate=round(row.fill_rate, 5),
                    artifact_row=row.artifact_row,
                    artifact_total_cost=round(row.cost_bikip, 2),
                )
            )

        feasible = [p for p in policies if p.is_feasible]
        if feasible:
            best = min(feasible, key=lambda p: p.total_cost)
            recommended = best.policy_id
            best_cost = best.total_cost
        else:
            best = max(policies, key=lambda p: p.availability)
            recommended = best.policy_id
            best_cost = min(p.total_cost for p in policies)
        for p in policies:
            p.cost_increase_vs_best = round(max(0.0, p.total_cost - best_cost), 2)

        by_id = {p.policy_id: p for p in policies}
        insights: List[str] = []
        details: List[InsightDetail] = []  # same order as ``insights``; stable codes for client-side i18n
        target_pct = round(target_service_level * 100, 1)
        if feasible:
            insights.append(
                f"Đề xuất {best.policy_name}: availability quan sát {best.availability:.1f}% >= mục tiêu "
                f"{target_service_level * 100:.1f}%, tổng chi phí thấp nhất trong các phương án đạt mục tiêu "
                f"({best.total_cost:,.2f} $ đã quy đổi)."
            )
            details.append(InsightDetail(code="recommend_feasible", params={
                "policy_id": best.policy_id, "policy_key": best.policy_key, "availability_pct": best.availability,
                "target_pct": target_pct, "total_cost": best.total_cost,
            }))
        else:
            insights.append(
                f"Không phương án nào trong artifact đạt availability {target_service_level * 100:.1f}%. "
                f"Gần nhất: {best.policy_name} ({best.availability:.1f}%)."
            )
            details.append(InsightDetail(code="recommend_infeasible", params={
                "policy_id": best.policy_id, "policy_key": best.policy_key, "availability_pct": best.availability,
                "target_pct": target_pct,
            }))
        pcr, p6, b0 = by_id["PCR_c3out_cost_optimal"], by_id["P6_c3out_closed_loop"], by_id["B0_raw_quantile"]
        cmp_word = "thấp hơn" if pcr.total_cost < p6.total_cost else "cao hơn"
        diff_pct = abs(pcr.total_cost - p6.total_cost) / max(1e-9, p6.total_cost) * 100.0
        insights.append(
            f"P-CR (τ={pcr.tau}) có tổng chi phí {cmp_word} P6 (τ={p6.tau}) {diff_pct:.2f}% "
            f"({pcr.total_cost:,.2f} so với {p6.total_cost:,.2f}); availability {pcr.availability:.1f}% so với {p6.availability:.1f}%."
        )
        details.append(InsightDetail(code="pcr_vs_p6", params={
            "direction": "lower" if pcr.total_cost < p6.total_cost else "higher",
            "tau_pcr": pcr.tau, "tau_p6": p6.tau, "diff_pct": round(diff_pct, 2),
            "cost_pcr": pcr.total_cost, "cost_p6": p6.total_cost,
            "availability_pcr_pct": pcr.availability, "availability_p6_pct": p6.availability,
        }))
        insights.append(
            f"B0 (raw quantile τ=0.95) chỉ đạt availability {b0.availability:.1f}% dù đặt mục tiêu 95%; "
            f"P6 điều khiển về {p6.availability:.1f}%. P6 là bộ điều khiển mức phục vụ, không phải bộ giảm chi phí."
        )
        details.append(InsightDetail(code="b0_vs_p6", params={
            "availability_b0_pct": b0.availability, "availability_p6_pct": p6.availability,
        }))
        insights.append(
            f"Nguồn: trích kết quả offline {art.n_skus:,} SKU x {art.n_days} ngày (c3ok_results.csv), quy đổi tuyến tính "
            f"theo {sku_count:,} SKU x {horizon_days} ngày; KHÔNG phải mô phỏng chạy lại. Chi phí theo A3 "
            f"(h=0.002·giá/ngày, b=0.35·giá, c=2/đơn)."
        )
        details.append(InsightDetail(code="artifact_source", params={
            "artifact_n_skus": art.n_skus, "artifact_n_days": art.n_days,
            "sku_count": sku_count, "horizon_days": horizon_days,
        }))

        return PolicyComparisonResponse(
            store_id=store_id,
            simulation_horizon_days=horizon_days,
            sku_count=sku_count,
            recommended_policy=recommended,
            recommended_policy_key=best.policy_key,
            policies=policies,
            insights=insights,
            insight_details=details,
            source="artifact_extract",
            simulated=False,
            as_of=art.as_of,
            n_skus=sku_count,
            artifact_n_skus=art.n_skus,
            artifact_n_days=art.n_days,
            scale_factor=round(scale, 12),
            scale_basis=f"(sku_count / {art.n_skus}) x (horizon_days / {art.n_days})",
            price_source=price_source,
            avg_price=round(avg_price, 4) if avg_price is not None else None,
            what_if=None,
            what_if_reason=(
                "Bảng này là trích kết quả artifact (không mô phỏng). Mô phỏng what-if THẬT trên lịch sử của cửa hàng: "
                "gửi kèm `what_if` trong request hoặc gọi POST /api/v1/simulation/what-if."
            ),
        )


simulation_service = SimulationService()
