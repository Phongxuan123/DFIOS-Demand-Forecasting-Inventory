import { describe, expect, it } from 'vitest';
import { translate, type TFunction } from '../i18n/index.tsx';
import { createFormatters } from '../i18n/format.ts';
import { localizeBe } from '../i18n/beText.ts';
import { costVsB0, countPhrase, reviewsPhrase, reviewsSinceStart, signedCurrency } from './simText.ts';
import { insightTexts, policyLabel } from './policyText.ts';

const tFor = (locale: 'vi' | 'en'): TFunction => (key, vars) => translate(locale, key, vars);
const beFor = (locale: 'vi' | 'en') => (raw: string | null | undefined) => localizeBe(locale, raw);

describe('review counts and plurals (bug: "1 reviews" / clock vs last advance)', () => {
  const en = tFor('en');
  const vi = tFor('vi');
  const fen = createFormatters('en');
  const fvi = createFormatters('vi');

  it('uses singular and plural forms in English', () => {
    expect(countPhrase(en, fen, 'reviews', 1)).toBe('1 review');
    expect(countPhrase(en, fen, 'reviews', 2)).toBe('2 reviews');
    expect(countPhrase(en, fen, 'days', 1)).toBe('1 day');
    expect(countPhrase(en, fen, 'stockouts', 0)).toBe('0 stockouts');
    expect(countPhrase(en, fen, 'recs', 1)).toBe('1 new recommendation');
  });

  it('has no plural in Vietnamese', () => {
    expect(countPhrase(vi, fvi, 'reviews', 1)).toBe('1 kỳ review');
    expect(countPhrase(vi, fvi, 'reviews', 2)).toBe('2 kỳ review');
  });

  it('counts the clock like /clock/advance (day-0 review included) and says so', () => {
    // after one 7-day advance from the start: BE reviews_elapsed = 1 (index k), advance reviews_executed = 2
    const clock = { days_elapsed: 7, reviews_elapsed: 1, reviews_executed_total: 2 };
    expect(reviewsSinceStart(clock)).toBe(2);
    expect(reviewsSinceStart({ days_elapsed: 7, reviews_elapsed: 1 })).toBe(2); // older BE without the field
    expect(reviewsSinceStart({ days_elapsed: 0, reviews_elapsed: 0 })).toBe(0);
    const card = reviewsPhrase(en, fen, reviewsSinceStart(clock), true);
    const last = reviewsPhrase(en, fen, 2, true);
    expect(card).toBe('2 reviews (incl. the day-0 review)');
    expect(card).toBe(last);
    expect(reviewsPhrase(en, fen, 1, false)).toBe('1 review');
    expect(reviewsPhrase(vi, fvi, 2, true)).toBe('2 kỳ review (gồm kỳ review ngày 0)');
  });
});

describe('C³-OUT vs B0 cost difference sign', () => {
  const fen = createFormatters('en');

  it('is C³-OUT minus B0: positive when C³-OUT costs more', () => {
    const cmp = costVsB0(7332, 7200);
    expect(cmp).toEqual({ diff: 132, direction: 'more' });
    expect(signedCurrency(fen, cmp!.diff, false)).toBe('+$132.00');
    expect(translate('en', 'dashboard.kpi.cost_hint', { b0: '$7.2K', delta: signedCurrency(fen, cmp!.diff) })).toBe('B0: $7.2K · C³-OUT − B0: +$132');
    expect(translate('en', `dashboard.kpi.cost_${cmp!.direction}`)).toBe('C³-OUT costs more');
  });

  it('is negative with a real minus sign when C³-OUT is cheaper, and null when a side is missing', () => {
    const cmp = costVsB0(7000, 7200);
    expect(cmp?.direction).toBe('less');
    expect(signedCurrency(fen, cmp!.diff)).toBe('−$200');
    expect(costVsB0(7000, null)).toBeNull();
    expect(costVsB0(7200, 7200)?.direction).toBe('equal');
  });
});

describe('Reports policy names and insights from stable codes (no Vietnamese in the EN UI)', () => {
  const en = tFor('en');
  const fen = createFormatters('en');
  const be = beFor('en');
  const vietnamese = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

  it('renders the policy label from policy_key, with BE text as fallback', () => {
    expect(policyLabel(en, be, 'PCR', 'P-CR - C³-OUT với setpoint = critical ratio (τ=0.9615)')).toBe('P-CR - C³-OUT with setpoint = critical ratio (τ=0.9615)');
    expect(policyLabel(en, be, null, 'P-CR - C³-OUT với setpoint = critical ratio (τ=0.9615)')).toBe('P-CR - C³-OUT with setpoint = critical ratio (τ=0.9615)');
    expect(policyLabel(en, be, 'XYZ', 'Raw label')).toBe('Raw label');
  });

  it('renders every insight code in English', () => {
    const details = [
      { code: 'recommend_feasible', params: { policy_id: 'PCR_c3out_cost_optimal', policy_key: 'PCR', availability_pct: 96.1, target_pct: 96, total_cost: 94634.91 } },
      { code: 'pcr_vs_p6', params: { direction: 'lower', tau_pcr: 0.9615, tau_p6: 0.95, diff_pct: 0.19, cost_pcr: 94634.91, cost_p6: 94814.23, availability_pcr_pct: 96.1, availability_p6_pct: 94.9 } },
      { code: 'b0_vs_p6', params: { availability_b0_pct: 90.7, availability_p6_pct: 94.9 } },
      { code: 'artifact_source', params: { artifact_n_skus: 25950, artifact_n_days: 357, sku_count: 3049, horizon_days: 90 } },
    ];
    const out = insightTexts(en, fen, be, ['a', 'b', 'c', 'd'], details);
    expect(out[0]).toBe('Recommended: P-CR - C³-OUT with setpoint = critical ratio (τ=0.9615). Observed availability 96.1% ≥ target 96.0%, lowest total cost among the options that meet the target ($94,634.91 scaled).');
    expect(out[1]).toContain('lower than P6');
    expect(out[3]).toContain('25,950 SKUs × 357 days');
    for (const s of out) expect(s).not.toMatch(vietnamese);
  });

  it('falls back to the BE sentence (with the nested policy label translated) without insight_details', () => {
    const raw = 'Đề xuất P-CR - C³-OUT với setpoint = critical ratio (τ=0.9615): availability quan sát 96.1% >= mục tiêu 96.0%, tổng chi phí thấp nhất trong các phương án đạt mục tiêu (94,634.91 $ đã quy đổi).';
    const [s] = insightTexts(en, fen, be, [raw], undefined);
    expect(s).not.toMatch(vietnamese);
    expect(s).toContain('P-CR - C³-OUT with setpoint');
  });

  it('unknown insight code falls back to the BE text', () => {
    const [s] = insightTexts(en, fen, be, ['Một câu chưa biết'], [{ code: 'new_code', params: {} }]);
    expect(s).toBe('Một câu chưa biết');
  });
});
