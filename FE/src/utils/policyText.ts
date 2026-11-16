/**
 * Artifact policy labels and /simulation/compare-policies insights rendered from stable BE codes
 * (policy_key, insight_details) in the selected language. The BE human text is only a fallback.
 */
import type { Formatters, TFunction, TKey } from '../i18n/index.tsx';

export const POLICY_KEYS = ['B0', 'B2', 'PCR', 'P6'] as const;
export type PolicyKey = (typeof POLICY_KEYS)[number];

const isPolicyKey = (k: unknown): k is PolicyKey => typeof k === 'string' && (POLICY_KEYS as readonly string[]).includes(k);

/** Fallback translator for BE text (useBe()). */
type BeFn = (raw: string | null | undefined) => string;

/** Localised policy label from `policy_key`; falls back to the BE label (through the be-text matcher). */
export function policyLabel(t: TFunction, be: BeFn, key: string | null | undefined, raw: string | null | undefined): string {
  if (isPolicyKey(key)) return t(`reports.policy_label.${key}` as TKey);
  return be(raw) || raw || '';
}

/** Localised policy description from `policy_key`; falls back to the BE description. */
export function policyDescription(t: TFunction, be: BeFn, key: string | null | undefined, raw: string | null | undefined): string {
  if (isPolicyKey(key)) return t(`reports.policy_desc.${key}` as TKey);
  return be(raw) || raw || '';
}

export interface InsightDetailLike {
  code: string;
  params: Record<string, string | number | null | undefined>;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * One insight from its code + params, or null when the code is unknown (caller then shows the BE sentence).
 * Percent params arrive in percent units (96.1 = 96.1 %); costs in USD.
 */
export function insightText(t: TFunction, fmt: Formatters, be: BeFn, d: InsightDetailLike): string | null {
  const p = d.params ?? {};
  const pct = (v: unknown) => fmt.percent(num(v), { scale: 'percent', digits: 1 });
  const pct2 = (v: unknown) => fmt.percent(num(v), { scale: 'percent', digits: 2 });
  const usd = (v: unknown) => fmt.currency(num(v), { digits: 2 });
  const nbr = (v: unknown, digits = 2) => fmt.number(num(v), { digits });
  const policy = () => policyLabel(t, be, p.policy_key as string | undefined, (p.policy_id as string | undefined) ?? '');
  switch (d.code) {
    case 'recommend_feasible':
      return t('reports.sim.insight.recommend_feasible', {
        policy: policy(), availability: pct(p.availability_pct), target: pct(p.target_pct), cost: usd(p.total_cost),
      });
    case 'recommend_infeasible':
      return t('reports.sim.insight.recommend_infeasible', { policy: policy(), availability: pct(p.availability_pct), target: pct(p.target_pct) });
    case 'pcr_vs_p6': {
      const vars = {
        tau_pcr: nbr(p.tau_pcr, 4), tau_p6: nbr(p.tau_p6, 4), pct: pct2(p.diff_pct),
        cost_pcr: usd(p.cost_pcr), cost_p6: usd(p.cost_p6), av_pcr: pct(p.availability_pcr_pct), av_p6: pct(p.availability_p6_pct),
      };
      return p.direction === 'higher' ? t('reports.sim.insight.pcr_vs_p6_higher', vars) : t('reports.sim.insight.pcr_vs_p6_lower', vars);
    }
    case 'b0_vs_p6':
      return t('reports.sim.insight.b0_vs_p6', { b0: pct(p.availability_b0_pct), p6: pct(p.availability_p6_pct) });
    case 'artifact_source':
      return t('reports.sim.insight.artifact_source', {
        n_art: fmt.integer(num(p.artifact_n_skus)), d_art: fmt.integer(num(p.artifact_n_days)),
        n: fmt.integer(num(p.sku_count)), d: fmt.integer(num(p.horizon_days)),
      });
    default:
      return null;
  }
}

/** All insights: structured ones when the BE sends insight_details, else the BE sentences through `be`. */
export function insightTexts(t: TFunction, fmt: Formatters, be: BeFn, insights: string[], details?: InsightDetailLike[] | null): string[] {
  if (details && details.length) {
    return details.map((d, i) => insightText(t, fmt, be, d) ?? be(insights[i] ?? d.code));
  }
  return insights.map((s) => be(s));
}
