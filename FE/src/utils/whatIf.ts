/**
 * FR10 what-if form: parsing, validation and the comparison of the returned policies.
 * Pure functions (unit tested); the panel only renders them.
 */
import type { WhatIfPolicyResult, WhatIfRequest } from '../services/reportsApi.ts';

export const LEAD_TIMES = [1, 3, 7] as const;
export const REVIEW_PERIODS = [1, 7] as const;

/** A3 defaults of the research (h = 0.002·price/day, b = 0.35·price, c = 2/order), L = 3, R = 7. */
export const WHAT_IF_DEFAULTS = { L: '3', R: '7', h: '0.002', b: '0.35', c: '2' };

export interface WhatIfForm {
  L: string;
  R: string;
  h: string;
  b: string;
  c: string;
}
export type WhatIfField = keyof WhatIfForm;

const parse = (s: string): number | null => {
  const v = s.trim().replace(',', '.');
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Field -> error kind ('required' | 'range'). Ranges mirror the BE schema (WhatIfRequest). */
export function validateWhatIf(f: WhatIfForm): Partial<Record<WhatIfField, 'required' | 'range'>> {
  const out: Partial<Record<WhatIfField, 'required' | 'range'>> = {};
  const check = (k: WhatIfField, ok: (n: number) => boolean) => {
    const n = parse(f[k]);
    if (n === null) out[k] = 'required';
    else if (!ok(n)) out[k] = 'range';
  };
  check('L', (n) => (LEAD_TIMES as readonly number[]).includes(n));
  check('R', (n) => (REVIEW_PERIODS as readonly number[]).includes(n));
  check('h', (n) => n >= 0 && n <= 1);
  check('b', (n) => n >= 0 && n <= 10);
  check('c', (n) => n >= 0 && n <= 10000);
  return out;
}

export function toWhatIfRequest(storeId: string, f: WhatIfForm): WhatIfRequest {
  return {
    store_id: storeId,
    lead_time_days: Number(f.L),
    review_period_days: Number(f.R),
    holding_rate: parse(f.h) as number,
    stockout_penalty_rate: parse(f.b) as number,
    order_cost: parse(f.c) as number,
  };
}

/** Availability as a 0..1 ratio from either field the BE may send. */
export function availabilityRatio(m: { availability?: number | null; availability_pct?: number | null }): number | null {
  if (typeof m.availability === 'number' && Number.isFinite(m.availability)) return m.availability;
  if (typeof m.availability_pct === 'number' && Number.isFinite(m.availability_pct)) return m.availability_pct / 100;
  return null;
}

/** Cheapest policy and the highest-availability policy of a run (null when not comparable). */
export function whatIfHighlights(policies: WhatIfPolicyResult[]): { cheapest: string | null; bestService: string | null } {
  if (policies.length < 2) return { cheapest: null, bestService: null };
  let cheapest: WhatIfPolicyResult | null = null;
  let best: WhatIfPolicyResult | null = null;
  for (const p of policies) {
    if (Number.isFinite(p.overall.total_cost) && (!cheapest || p.overall.total_cost < cheapest.overall.total_cost)) cheapest = p;
    const av = availabilityRatio(p.overall);
    if (av !== null && (!best || av > (availabilityRatio(best.overall) ?? -1))) best = p;
  }
  return { cheapest: cheapest?.policy_key ?? null, bestService: best?.policy_key ?? null };
}
