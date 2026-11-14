"""
Align the database with the scientific artifacts (research.md, c3ok_artifacts). Last step of the build.

One date convention (P-35 / N-11): policy_config.DEMO_START_DATE.
- sim_clock -> demo start date (the quantile origin is created at that date by
  load_forecast_window_quantile; nothing is renamed in place any more).
- policy_selection of the DEMO selection only (m_g = 0, kappa = 1, setpoint 0.95; val_* = artifact values).
  Other selections (J5 results) are never touched.
- calibration_state: the theta trajectory is KEPT. When no trajectory exists (only the neutral rev_0), the
  artifact final e^theta is added as a warm-start state at the next review index (m_g stays 0, so the
  multiplier is applied exactly once, N-05).
- model_registry: only the artifact WRMSSE values (RUN_SUMMARY_C3OK.md / c3ok_fidelity.json, h = 7).
- inventory_params recomputed ONCE at the end with the single formula (B-20).
- policy benchmark numbers are saved in system_settings (extract of the artifact).
"""
import sys
import os
import math
from datetime import date, datetime, timezone
import json

# Setup BE path
BE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, BE_DIR)

from app.core.database import SessionLocal
from app.services import policy_config as pc
from sqlalchemy import text

STORE = pc.DEMO_STORE_ID
WARM_START_CALIBRATOR = "c3ok_artifact_final"


def run_sync():
    db = SessionLocal()
    try:
        print(f"=== 1. ALIGNING SIM_CLOCK TO {pc.DEMO_START_DATE} ===")
        db.execute(text("""
            UPDATE sim_clock
            SET "current_date" = :d, start_date = :d, updated_at = NOW()
            WHERE store_id = :s
        """), {"d": pc.DEMO_START_DATE, "s": STORE})

        print("\n=== 3. SYNCING TIER 2 POLICY_SELECTION (demo selection only; m_g = 0, kappa_g = 1) ===")
        # Measured per-class CSL / cost of policy "P C3-OUT tau=0.95" (c3ok_csl_by_class.csv, c3ok_results.csv)
        optimal_policies = {
            "AX": {"val_cost": 319489.84, "val_service": 0.9495},
            "AY": {"val_cost": 395968.80, "val_service": 0.9494},
            "AZ": {"val_cost": 66254.19,  "val_service": 0.9490},
            "BX": {"val_cost": 64478.95,  "val_service": 0.9499},
            "BY": {"val_cost": 421200.50, "val_service": 0.9491},
            "BZ": {"val_cost": 156711.20, "val_service": 0.9489},
            "CX": {"val_cost": 2907.45,   "val_service": 0.9483},
            "CY": {"val_cost": 176043.10, "val_service": 0.9492},
            "CZ": {"val_cost": 491428.00, "val_service": 0.9479},
        }
        for class_id, p in optimal_policies.items():
            db.execute(text("""
                UPDATE policy_selection
                SET m_g = 0.0, kappa_g = 1.0, val_cost = :val_cost, val_service = :val_service,
                    setpoint = :sp, tau = :sp
                WHERE class_id = :class_id AND selection_id = :sid
            """), {**p, "class_id": class_id, "sid": pc.DEMO_SELECTION_ID, "sp": pc.TARGET_AVAILABILITY})
        print(f"Updated policy_selection {pc.DEMO_SELECTION_ID} for 9 classes")

        print("\n=== 4. TIER 3 CALIBRATION_STATE (trajectory kept) ===")
        # Final e^theta of policy P C3-OUT tau=0.95 (RUN_SUMMARY_C3OK.md): AX 1.095, AY 1.201, AZ 1.481,
        # BX 1.094, BY 1.172, BZ 1.468, CX 1.149, CY 1.133, CZ 1.397
        theta_final = {"AX": 0.0908, "AY": 0.1832, "AZ": 0.3927, "BX": 0.0898, "BY": 0.1587,
                       "BZ": 0.3839, "CX": 0.1389, "CY": 0.1249, "CZ": 0.3343}
        for class_id, th in theta_final.items():
            mx = db.execute(text(
                "SELECT max(review_index) FROM calibration_state WHERE store_id=:s AND class_id=:c"),
                {"s": STORE, "c": class_id}).scalar()
            warm = db.execute(text(
                "SELECT review_index FROM calibration_state WHERE store_id=:s AND class_id=:c AND calibrator_id=:k"),
                {"s": STORE, "c": class_id, "k": WARM_START_CALIBRATOR}).scalar()
            if warm is not None:  # idempotent refresh of our own warm-start row
                idx = warm
                db.execute(text("""UPDATE calibration_state SET theta=:t, multiplier=:m, review_date=:d
                                   WHERE store_id=:s AND class_id=:c AND review_index=:i"""),
                           {"t": th, "m": round(math.exp(th), 4), "d": pc.DEMO_START_DATE, "s": STORE,
                            "c": class_id, "i": idx})
            elif mx is None or mx == 0:  # only the neutral rev_0 (or nothing): add the warm-start state
                idx = (mx or 0) + 1
                db.execute(text("""
                    INSERT INTO calibration_state (id, calibrator_id, store_id, class_id, review_index, review_date,
                        theta, multiplier, error_rate, at_boundary, setpoint, eta, created_at)
                    VALUES (:id, :k, :s, :c, :i, :d, :t, :m, NULL, false, :sp, :eta, NOW())
                    ON CONFLICT (id) DO UPDATE SET theta = EXCLUDED.theta, multiplier = EXCLUDED.multiplier
                """), {"id": f"{STORE}_{class_id}_rev_{idx}", "k": WARM_START_CALIBRATOR, "s": STORE, "c": class_id,
                       "i": idx, "d": pc.DEMO_START_DATE, "t": th, "m": round(math.exp(th), 4),
                       "sp": pc.TARGET_AVAILABILITY, "eta": pc.CONTROLLER_ETA})
            else:
                print(f"  {class_id}: theta trajectory present (max review {mx}), left unchanged")
        print("Calibration states synced without deleting history.")

        print("\n=== 5. SYNCING MODEL_REGISTRY METRICS (artifact WRMSSE, h = 7) ===")
        # c3ok_fidelity.json / RUN_SUMMARY_C3OK.md "Result OK" column. MAE / RMSE / MASE have no source in the
        # artifact and are NOT written (R-04, N-06).
        for algo, wr, prod in (("ensemble", 0.4935, True), ("lightgbm", 0.5083, False),
                               ("xgboost", 0.5213, False), ("tft", 0.5004, False)):
            db.execute(text("""
                UPDATE model_registry
                SET metrics = :m, is_production = :p
                WHERE algorithm = :a OR (:a = 'ensemble' AND name ILIKE '%ensemble%')
            """), {"m": json.dumps({"wrmsse": wr}), "p": prod, "a": algo})
        print("Updated model_registry with artifact WRMSSE values.")

        print("\n=== 6. SAVING SCIENTIFIC BENCHMARK RESULTS IN SYSTEM_SETTINGS ===")
        # Khớp 100% nhãn và kết quả từ c3ok_results.csv & c3ok_pairs.csv
        benchmark_data = {
            "title": "DFIOS C3-OUT Policy Evaluation on M5 Walmart (72 Review Cycles)",
            "test_summary": {
                "P0_Traditional": {
                    "policy": "B0 DFIOS τ=0.95",
                    "tau": 0.95,
                    "csl": 0.9071,
                    "fill_rate": 0.9405,
                    "holding_cost": 714598.98,
                    "shortage_cost": 773751.84,
                    "ordering_cost": 1923694.00,
                    "total_cost_bikip": 3412044.82,
                    "total_cost_paper": 767052.47
                },
                "P1_Static_EOQ": {
                    "policy": "B2 DFIOS τ*=0.99 [BIKIP]",
                    "tau": 0.99,
                    "csl": 0.9336,
                    "fill_rate": 0.9556,
                    "holding_cost": 852948.76,
                    "shortage_cost": 575342.87,
                    "ordering_cost": 1928790.00,
                    "total_cost_bikip": 3357081.62,
                    "total_cost_paper": 699361.32
                },
                "P4_Refit_EOQ": {
                    "policy": "P-CR C³-OUT τ=0.9615 [BIKIP]",
                    "tau": 0.9615,
                    "csl": 0.9605,
                    "fill_rate": 0.9750,
                    "holding_cost": 984863.21,
                    "shortage_cost": 307251.18,
                    "ordering_cost": 1902784.00,
                    "total_cost_bikip": 3194898.39,
                    "total_cost_paper": 598919.84
                },
                "P6_C3_OUT": {
                    "policy": "P C³-OUT τ=0.95",
                    "tau": 0.95,
                    "csl": 0.9490,
                    "fill_rate": 0.9683,
                    "holding_cost": 900606.68,
                    "shortage_cost": 391639.43,
                    "ordering_cost": 1908706.00,
                    "total_cost_bikip": 3200952.10,
                    "total_cost_paper": 629384.80
                }
            },
            "comparisons": {
                "P_vs_B0_tau_095": {
                    "delta_cost_paper_pct": -17.95,
                    "delta_cost_bikip_pct": -6.19,
                    "csl_target": 0.95,
                    "csl_achieved": 0.9490,
                    "sku_cheaper_pct": 86.54,
                    "wilcoxon_p": 0.0
                },
                "P_CR_vs_B2": {
                    "delta_cost_paper_pct": -24.65,
                    "delta_cost_bikip_pct": -4.83,
                    "sku_cheaper_pct": 81.60,
                    "wilcoxon_p": 0.0
                }
            },
            "coverage_095": 0.8314,
            "wrmsse_ensemble": 0.4935
        }

        # Upsert into system_settings
        db.execute(text("""
            INSERT INTO system_settings (key, value, description, updated_at)
            VALUES ('policy_benchmark_results', :val, 'Empirical M5 Results for Policies P0-P6', NOW())
            ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value,
                updated_at = NOW()
        """), {"val": json.dumps(benchmark_data)})
        print("Upserted policy_benchmark_results into system_settings.")

        db.commit()

        print("=== 7. RECOMPUTING inventory_params ONCE (single formula, L=3, R=7) ===")
        from app.services.optimization_service import optimization_service
        n = optimization_service.recompute_parameters(db, store_id=STORE)
        print(f"Recomputed {n} SKUs.")
        print("\n>>> ALL SCIENTIFIC BASELINES SYNCED TO DATABASE SUCCESSFULLY! <<<")

    except Exception as e:
        db.rollback()
        print(f"ERROR DURING SYNC: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    run_sync()
