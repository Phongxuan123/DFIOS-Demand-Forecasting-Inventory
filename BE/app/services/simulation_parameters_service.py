"""Simulation parameters on the Settings screen (demo.md §1.3: "L, R và chi phí (h, b, c) là cấu hình trên màn hình
Settings. Mặc định: L = 3, R = 7, h = 0,002·giá/ngày, b = 0,35·giá, c = 2").

* h, b, c are editable (system setting ``simulation_costs``), only while every simulated clock is still on its start
  date: a replay keeps one set of costs from its first day, so its cost curve and its B0 comparison stay consistent.
* L and R are read-only here: they define the window H = L + R of the stored window quantiles, so another (L, R) needs
  other quantiles; the what-if simulator (Reports) evaluates L in {1, 3, 7} and R in {1, 7}.
* The service target and the C3-OUT constants are shown for reference (target: Settings > service level).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.sim_clock import SimClock
from app.models.system_setting import SystemSetting
from app.services import policy_config as pc
from app.services.audit_service import audit_service


def _clocks_not_at_start(db: Session) -> List[str]:
    return [c.store_id for c in db.query(SimClock).all() if c.current_date != c.start_date]


def get_parameters(db: Session) -> Dict[str, Any]:
    from app.services.optimization_service import optimization_service

    costs = pc.sync_costs(db)
    moved = _clocks_not_at_start(db)
    target = float(optimization_service.get_service_level_config(db).default_service_level)
    return {
        "lead_time_days": pc.LEAD_TIME_DAYS,
        "review_period_days": pc.REVIEW_PERIOD_DAYS,
        "horizon_days": pc.HORIZON_DAYS,
        **costs,
        "defaults": {
            "holding_rate": pc.HOLDING_RATE_DAILY_DEFAULT,
            "stockout_penalty_rate": pc.STOCKOUT_PENALTY_RATE_DEFAULT,
            "order_cost": pc.ORDER_COST_C_DEFAULT,
        },
        "limits": {k: list(v) for k, v in pc.COST_LIMITS.items()},
        "target_availability": target,
        "selection_guard": pc.SELECTION_GUARD_AVAILABILITY,
        "c3out": {"eta": pc.CONTROLLER_ETA, "setpoint": pc.C3_SETPOINT, "theta_min": pc.THETA_MIN,
                  "theta_max": pc.THETA_MAX, "variant": pc.C3_VARIANT},
        "costs_editable": not moved,
        "costs_locked_stores": moved,
    }


def update_costs(
    db: Session,
    holding_rate: Optional[float],
    stockout_penalty_rate: Optional[float],
    order_cost: Optional[float],
    actor_email: Optional[str] = None,
    ip_address: Optional[str] = None,
) -> Dict[str, Any]:
    moved = _clocks_not_at_start(db)
    if moved:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "costs_locked", "stores": moved,
                    "message": "Chi phí h, b, c chỉ đổi được khi đồng hồ còn ở ngày đầu (khôi phục snapshot demo_start)."},
        )
    new = {"holding_rate": holding_rate, "stockout_penalty_rate": stockout_penalty_rate, "order_cost": order_cost}
    for k, v in new.items():
        if v is None:
            continue
        lo, hi = pc.COST_LIMITS[k]
        if not (lo <= float(v) <= hi):
            raise HTTPException(status_code=422,
                                detail={"code": "cost_out_of_range", "field": k, "min": lo, "max": hi})
    old = pc.sync_costs(db)
    merged = {k: float(new[k]) if new[k] is not None else old[k] for k in old}
    row = db.query(SystemSetting).filter(SystemSetting.key == pc.COSTS_SETTING_KEY).first()
    if row is None:
        db.add(SystemSetting(key=pc.COSTS_SETTING_KEY, value=merged))
    else:
        row.value = merged
    audit_service.log(
        db, action="settings.update_simulation_costs", actor_email=actor_email, ip_address=ip_address,
        details=f"h, b, c: {old} -> {merged}",
    )
    db.commit()
    pc.apply_costs(**merged)
    return get_parameters(db)
