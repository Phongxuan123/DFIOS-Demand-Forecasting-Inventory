"""CLI: replay the teacher's E10b / E9c policies on the teacher's data (read-only).

Example (from BE/):
    python scripts/replay_e10b.py --policy REFIT-RSS-EOQ-G --L 3 --R 7 --out result.json
    python scripts/replay_e10b.py --policy REFIT-RSS-G REFIT-RSS-C3 --stores CA_1

Nothing is written inside the teacher folder; ``--out`` must point elsewhere.
"""
import argparse
import json
import os
import sys
import time

sys.dont_write_bytecode = True
BE_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
if BE_DIR not in sys.path:
    sys.path.insert(0, BE_DIR)

from app.services.e10b_replay import (  # noqa: E402
    POLICIES,
    ReplayConfig,
    load_teacher_inputs,
    public_result,
    replay,
    teacher_dir_default,
)


def _inside(path: str, folder: str) -> bool:
    path, folder = os.path.normcase(os.path.realpath(path)), os.path.normcase(os.path.realpath(folder))
    try:
        return os.path.commonpath([path, folder]) == folder
    except ValueError:  # different drives
        return False


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--teacher-dir", default=teacher_dir_default(), help="teacher folder (env TEACHER_DIR)")
    ap.add_argument("--model", default="ensemble")
    ap.add_argument("--policy", nargs="+", default=["REFIT-RSS-EOQ-G"], choices=POLICIES)
    ap.add_argument("--L", type=int, default=3)
    ap.add_argument("--R", type=int, default=7)
    ap.add_argument("--stores", default=None, help="comma-separated store ids, e.g. CA_1 (default: all 3)")
    ap.add_argument("--labels", default="teacher", choices=["teacher", "merge_small"],
                    help="class labels: teacher's pooled abcxyz_merged, or merge_small on the subset")
    ap.add_argument("--out", default=None, help="write results JSON here (never inside the teacher folder)")
    args = ap.parse_args(argv)

    if args.out and _inside(args.out, args.teacher_dir):
        ap.error("--out must not be inside the teacher folder (read-only)")
    stores = [s.strip() for s in args.stores.split(",") if s.strip()] if args.stores else None
    cfg = ReplayConfig(L=args.L, R=args.R)

    t0 = time.time()
    inputs = load_teacher_inputs(args.teacher_dir, args.model, stores, cfg, labels=args.labels)
    print(f"loaded {inputs.n} SKUs, classes {inputs.class_names}, K={len(inputs.review_days)} "
          f"({time.time() - t0:.1f}s)", flush=True)
    if stores:
        print("NOTE: store subset -> numbers will NOT equal the teacher's 3-store totals.")

    results, cache = [], {}
    for pol in args.policy:
        t1 = time.time()
        res = replay(inputs, cfg, pol, candidate_stats=cache.get("eoq" if "EOQ" in pol else "mu_r"))
        cache[res["batch_rule"]] = res["_candidates"]
        res["seconds"] = round(time.time() - t1, 1)
        results.append(public_result(res))

    hdr = f"{'policy':<16}{'cost':>13}{'holding':>13}{'lost':>12}{'ordering':>11}{'orders':>8}" \
          f"{'fill':>9}{'minCSL':>8}{'cyc':>5}{'sec':>6}"
    print(hdr)
    print("-" * len(hdr))
    for r in results:
        print(f"{r['policy']:<16}{r['cost']:>13,.2f}{r['holding']:>13,.2f}{r['lost']:>12,.2f}"
              f"{r['ordering']:>11,.0f}{r['orders']:>8d}{r['fill']:>9.6f}{r['min_class_csl']:>8.4f}"
              f"{r['n_cycles']:>5d}{r['seconds']:>6.1f}")
    for r in results:
        last = r["selection"]["schedule"][-1]
        print(f"{r['policy']} last schedule (start {last['start']}): "
              + ", ".join(f"{c}:m={m},k={k}" for c, m, k in zip(r["classes"], last["m"], last["kappa"])))

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(results if len(results) > 1 else results[0], f, indent=1)
        print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
