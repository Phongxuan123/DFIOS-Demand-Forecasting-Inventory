/**
 * Axis helpers for small charts (U-14).
 * Display only: these never change a value, they only choose a readable y-range.
 */

/** Hard display limits of the C³-OUT correction θ (the controller clamps θ to this range). */
export const THETA_LIMITS: readonly [number, number] = [-2, 2];

const roundDown = (v: number, step: number) => Math.floor(v / step) * step;
const roundUp = (v: number, step: number) => Math.ceil(v / step) * step;

/**
 * Y-domain for a θ trajectory: tight around the data (so a drift of 0.09 -> 0.02 is visible),
 * always includes 0 when the data is near it, never wider than the controller limits and
 * never thinner than ±0.1 around the data.
 */
export function thetaDomain(values: ReadonlyArray<number | null | undefined>): [number, number] {
  const finite = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (finite.length === 0) return [-0.5, 0.5];
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  const pad = Math.max((hi - lo) * 0.2, 0.05);
  lo -= pad;
  hi += pad;
  // Keep the zero line in view when the data sits close to it (θ = 0 is "no correction").
  if (lo > 0 && lo < 0.25) lo = 0;
  if (hi < 0 && hi > -0.25) hi = 0;
  if (hi - lo < 0.2) {
    const mid = (hi + lo) / 2;
    lo = mid - 0.1;
    hi = mid + 0.1;
  }
  const step = hi - lo > 1 ? 0.25 : 0.05;
  lo = Math.max(THETA_LIMITS[0], roundDown(lo, step));
  hi = Math.min(THETA_LIMITS[1], roundUp(hi, step));
  return [Number(lo.toFixed(2)), Number(hi.toFixed(2))];
}

/** Number of distinct x positions in a series: a line needs at least two. */
export const distinctX = <T>(rows: ReadonlyArray<T>, key: (r: T) => unknown): number => new Set(rows.map(key)).size;
