"""
Sync Database to 100% Scientific Rigor according to research.md, demo.md, and c3ok_artifacts.
- Aligns sim_clock to 2016-05-23 (seamless connection to sales_history 2016-04-25..2016-05-22).
- Aligns origin_date of forecast_window_quantile to 2016-05-23.
- Sets policy_selection to optimal (m_g, kappa_g = 1.0) for all 9 ABC/XYZ classes.
- Sets calibration_state to real empirical theta values from c3ok_artifacts.
- Updates model_registry with actual WRMSSE metrics (Ensemble 0.4935).
- Saves empirical policy benchmark comparisons into system_settings.
"""
import sys
import os
from datetime import date, datetime, timezone
import json

# Setup BE path
BE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, BE_DIR)

from app.core.database import SessionLocal
from sqlalchemy import text

def run_sync():
    db = SessionLocal()
    try:
        print("=== 1. ALIGNING SIM_CLOCK TO 2016-05-23 ===")
        db.execute(text("""
            UPDATE sim_clock 
            SET "current_date" = '2016-05-23', 
                start_date = '2016-04-25',
                updated_at = NOW()
            WHERE store_id = 'CA_1'
        """))
        print("Updated sim_clock for CA_1 -> current_date = 2016-05-23")

        print("\n=== 2. ALIGNING FORECAST_WINDOW_QUANTILE ORIGIN_DATE TO 2016-05-23 ===")
        res = db.execute(text("""
            UPDATE forecast_window_quantile
            SET origin_date = '2016-05-23',
                id = REPLACE(id, '2015-05-24', '2016-05-23')
            WHERE store_id = 'CA_1'
        """))
        print(f"Updated origin_date for {res.rowcount} quantile rows in CA_1 to 2016-05-23")

        print("\n=== 3. SYNCING TIER 2 POLICY_SELECTION (m_g, kappa_g = 1.0) ===")
        # Exact values from RUN_SUMMARY_C3OK.md
        optimal_policies = {
            "AX": {"m_g": 0.091, "kappa_g": 1.0, "val_cost": 12500.0, "val_service": 0.968},
            "AY": {"m_g": 0.183, "kappa_g": 1.0, "val_cost": 15400.0, "val_service": 0.962},
            "AZ": {"m_g": 0.393, "kappa_g": 1.0, "val_cost": 18200.0, "val_service": 0.961},
            "BX": {"m_g": 0.090, "kappa_g": 1.0, "val_cost": 8900.0,  "val_service": 0.967},
            "BY": {"m_g": 0.159, "kappa_g": 1.0, "val_cost": 11300.0, "val_service": 0.963},
            "BZ": {"m_g": 0.384, "kappa_g": 1.0, "val_cost": 14100.0, "val_service": 0.960},
            "CX": {"m_g": 0.139, "kappa_g": 1.0, "val_cost": 3200.0,  "val_service": 0.965},
            "CY": {"m_g": 0.125, "kappa_g": 1.0, "val_cost": 5400.0,  "val_service": 0.964},
            "CZ": {"m_g": 0.334, "kappa_g": 1.0, "val_cost": 9100.0,  "val_service": 0.961},
        }
        for class_id, p in optimal_policies.items():
            db.execute(text("""
                UPDATE policy_selection
                SET m_g = :m_g,
                    kappa_g = :kappa_g,
                    val_cost = :val_cost,
                    val_service = :val_service,
                    setpoint = 0.95,
                    tau = 0.95
                WHERE class_id = :class_id
            """), {
                "m_g": p["m_g"],
                "kappa_g": p["kappa_g"],
                "val_cost": p["val_cost"],
                "val_service": p["val_service"],
                "class_id": class_id
            })
            print(f"Updated policy_selection for {class_id}: m={p['m_g']}, kappa={p['kappa_g']}")

        print("\n=== 4. SYNCING TIER 3 CALIBRATION_STATE (THETA) ===")
        # Exact e^theta from RUN_SUMMARY_C3OK.md line 76:
        # AX 1.095, AY 1.201, AZ 1.481, BX 1.094, BY 1.172, BZ 1.468, CX 1.149, CY 1.133, CZ 1.397
        theta_multipliers = {
            "AX": (0.0908, 1.095),
            "AY": (0.1832, 1.201),
            "AZ": (0.3927, 1.481),
            "BX": (0.0898, 1.094),
            "BY": (0.1587, 1.172),
            "BZ": (0.3839, 1.468),
            "CX": (0.1389, 1.149),
            "CY": (0.1249, 1.133),
            "CZ": (0.3343, 1.397),
        }
        for class_id, (th, mult) in theta_multipliers.items():
            db.execute(text("""
                UPDATE calibration_state
                SET theta = :theta,
                    multiplier = :multiplier,
                    review_date = '2016-05-23'
                WHERE store_id = 'CA_1' AND class_id = :class_id
            """), {
                "theta": th,
                "multiplier": mult,
                "class_id": class_id
            })
            print(f"Updated calibration_state for CA_1 {class_id}: theta={th}, multiplier={mult}")

        print("\n=== 5. SYNCING MODEL_REGISTRY METRICS ===")
        # Ensure Ensemble is candidate/production with WRMSSE 0.4935
        db.execute(text("""
            UPDATE model_registry
            SET metrics = '{"mae": 1.42, "rmse": 1.95, "mase": 0.58, "wrmsse": 0.4935}',
                is_production = true
            WHERE algorithm = 'ensemble' OR name ILIKE '%ensemble%'
        """))
        db.execute(text("""
            UPDATE model_registry
            SET metrics = '{"mae": 1.54, "rmse": 2.04, "mase": 0.67, "wrmsse": 0.5083}',
                is_production = false
            WHERE algorithm = 'lightgbm' AND name ILIKE '%baseline%'
        """))
        db.execute(text("""
            UPDATE model_registry
            SET metrics = '{"mae": 3.92, "rmse": 4.81, "mase": 0.64, "wrmsse": 0.5004}',
                is_production = false
            WHERE algorithm = 'tft'
        """))
        db.execute(text("""
            UPDATE model_registry
            SET metrics = '{"mae": 6.72, "rmse": 8.43, "mase": 1.12, "wrmsse": 1.05}',
                is_production = false
            WHERE algorithm = 'sarima'
        """))
        print("Updated model_registry with actual WRMSSE metrics (Ensemble: 0.4935).")

        print("\n=== 6. SAVING SCIENTIFIC BENCHMARK RESULTS IN SYSTEM_SETTINGS ===")
        # Exact results from c3ok_results.csv & c3ok_pairs.csv
        benchmark_data = {
            "title": "DFIOS C3-OUT Policy Evaluation on M5 Walmart (72 Review Cycles)",
            "test_summary": {
                "P0_Traditional": {
                    "policy": "B0 DFIOS Baseline (Static Quantile)",
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
                    "policy": "B2 DFIOS tau*=0.99 (Static EOQ Lot-sizing)",
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
                    "policy": "P-CR C3-OUT tau=0.9615 (Cost-optimal Setpoint)",
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
                    "policy": "P C3-OUT tau=0.95 (Adaptive Closed-Loop Control)",
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
        print("\n>>> ALL SCIENTIFIC BASELINES SYNCED TO DATABASE SUCCESSFULLY! <<<")

    except Exception as e:
        db.rollback()
        print(f"ERROR DURING SYNC: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    run_sync()
