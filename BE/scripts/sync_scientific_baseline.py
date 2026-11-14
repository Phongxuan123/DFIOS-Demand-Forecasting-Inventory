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
        # Q-07: the artifact TEST values (cost, CSL 0.948-0.950) are NOT written as validation metrics any more:
        # val_cost / val_service / is_feasible stay NULL and the row is labelled source = "artifact".
        # Q-06: setpoint = A_g + guard (research.md 8.2).
        db.execute(text("""
            UPDATE policy_selection
            SET m_g = 0.0, kappa_g = 1.0, val_cost = NULL, val_service = NULL, is_feasible = NULL,
                source = 'artifact', setpoint = :sp, tau = :tau
            WHERE selection_id = :sid
        """), {"sid": pc.DEMO_SELECTION_ID, "sp": pc.TARGET_AVAILABILITY + pc.GUARD, "tau": pc.TARGET_AVAILABILITY})
        print(f"Updated policy_selection {pc.DEMO_SELECTION_ID} (source=artifact, no invented validation metrics)")

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
            elif mx is None or mx == 0:  # only the neutral rev_0 (or nothing): the warm start REPLACES rev_0
                # review_index 0 (not 1): the simulator's reviews k = 1, 2, ... never collide with it and
                # POST /clock/reset (which deletes review_index >= 1) restores exactly this baseline (Q-04).
                db.execute(text("DELETE FROM calibration_state WHERE store_id=:s AND class_id=:c AND review_index = 0"),
                           {"s": STORE, "c": class_id})
                db.execute(text("""
                    INSERT INTO calibration_state (id, calibrator_id, store_id, class_id, review_index, review_date,
                        theta, multiplier, error_rate, at_boundary, setpoint, eta, created_at)
                    VALUES (:id, :k, :s, :c, 0, :d, :t, :m, NULL, false, :sp, :eta, NOW())
                """), {"id": f"{STORE}_{class_id}_rev_0", "k": WARM_START_CALIBRATOR, "s": STORE, "c": class_id,
                       "d": pc.DEMO_START_DATE, "t": th, "m": round(math.exp(th), 4),
                       "sp": pc.TARGET_AVAILABILITY + pc.GUARD, "eta": pc.CONTROLLER_ETA})
            else:
                print(f"  {class_id}: theta trajectory present (max review {mx}), left unchanged")
        print("Calibration states synced without deleting history.")

        print("\n=== 5. SYNCING MODEL_REGISTRY METRICS (artifact WRMSSE, h = 7) ===")
        # WRMSSE: c3ok_fidelity.json / RUN_SUMMARY_C3OK.md "Result OK" column; ensemble MAE/RMSE/MASE: MODEL/best_params.json
        # test_metrics h=7d. Other models: no MAE/RMSE/MASE source -> not written (R-04, N-06).
        def metrics_for(algo, wr):
            m = {"wrmsse": wr, "metrics_source": {"wrmsse": "artifact:c3ok Result OK (h=7)"}}
            if algo == "ensemble":  # MODEL/best_params.json test_metrics h=7d
                m.update({"mase": 0.9753, "mae": 0.9467, "rmse": 1.8509})
                m["metrics_source"] = {k: "artifact:MODEL/best_params.json test_metrics h=7d"
                                       for k in ("wrmsse", "mase", "mae", "rmse")}
            return m

        for algo, wr, prod in (("ensemble", 0.4935, True), ("lightgbm", 0.5083, False),
                               ("xgboost", 0.5213, False), ("tft", 0.5004, False)):
            db.execute(text("""
                UPDATE model_registry
                SET metrics = :m, is_production = :p
                WHERE algorithm = :a OR (:a = 'ensemble' AND name ILIKE '%ensemble%')
            """), {"m": json.dumps(metrics_for(algo, wr)), "p": prod, "a": algo})
        print("Updated model_registry with artifact WRMSSE values.")

        print("\n=== 6. SAVING SCIENTIFIC BENCHMARK RESULTS IN SYSTEM_SETTINGS ===")
        # Khớp 100% nhãn và kết quả từ c3ok_results.csv & c3ok_pairs.csv
        benchmark_data = {
            "title": "DFIOS C3-OUT Policy Evaluation on M5 Walmart (72 Review Cycles)",
            "test_summary": {
                "B0_Raw_Quantile_095": {
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
                "B2_Raw_Quantile_099": {
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
                "PCR_C3OUT_09615": {
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
                "P6_C3OUT_095": {
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
            "coverage_095_source": "artifact:c3ok c3ok_forecast_calibration.csv test cover_0.95",
            "wrmsse_ensemble": 0.4935
        }

        # Upsert into system_settings
        db.execute(text("""
            INSERT INTO system_settings (key, value, description, updated_at)
            VALUES ('policy_benchmark_results', :val, 'Empirical M5 Results (artifact c3ok): B0 / B2 / P-CR / P6 (N-06: labels = artifact rows)', NOW())
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

        print("=== 8. POLICY-CONSISTENT INITIAL STOCK (Q-03): each SKU starts at its S ===")
        from app.services.simulator_service import simulator_service
        info = simulator_service.initialise_baseline(db, STORE)
        print(f"Initial inventory = S for {info['n_skus']} SKUs (sum on_hand {info['total_on_hand']:.0f}); snapshot stored.")
        print("\n>>> ALL SCIENTIFIC BASELINES SYNCED TO DATABASE SUCCESSFULLY! <<<")

    except Exception as e:
        db.rollback()
        print(f"ERROR DURING SYNC: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    run_sync()
