/** Small, pure text helpers for simulator figures (plural counts, signed cost difference). */
import type { Formatters, TFunction, TKey } from '../i18n/index.tsx';

/** Plural category used by the `<base>_one` / `<base>_other` keys (vi has no plural, both forms are equal). */
export function pluralCategory(n: number): 'one' | 'other' {
  return n === 1 ? 'one' : 'other';
}

/** Countable phrases with `_one` / `_other` variants in dashboard.count. */
export type CountBase = 'days' | 'reviews' | 'stockouts' | 'recs';

/** "1 review" / "2 reviews" (formatted count). */
export function countPhrase(t: TFunction, fmt: Formatters, base: CountBase, n: number): string {
  return t(`dashboard.count.${base}_${pluralCategory(n)}` as TKey, { count: fmt.integer(n) });
}

/**
 * Reviews phrase, marking when the count includes the day-0 review (the review at the START of start_date,
 * run by the first advance), so the clock card and the last-advance line read the same way.
 */
export function reviewsPhrase(t: TFunction, fmt: Formatters, n: number, includesDay0: boolean): string {
  const base = countPhrase(t, fmt, 'reviews', n);
  return includesDay0 && n > 0 ? `${base} ${t('dashboard.count.incl_day0')}` : base;
}

/** Reviews run since start incl. the day-0 review; falls back to k + 1 for an older backend without the field. */
export function reviewsSinceStart(clock: { days_elapsed: number; reviews_elapsed: number; reviews_executed_total?: number | null }): number {
  if (clock.reviews_executed_total != null) return clock.reviews_executed_total;
  return clock.days_elapsed > 0 ? clock.reviews_elapsed + 1 : 0;
}

export type CostDirection = 'more' | 'less' | 'equal';

/** C³-OUT − B0 (positive = C³-OUT costs MORE than B0). Null when either side is missing. */
export function costVsB0(c3: number | null | undefined, b0: number | null | undefined): { diff: number; direction: CostDirection } | null {
  if (c3 == null || b0 == null || !Number.isFinite(c3) || !Number.isFinite(b0)) return null;
  const diff = Math.round((c3 - b0) * 100) / 100;
  return { diff, direction: diff > 0 ? 'more' : diff < 0 ? 'less' : 'equal' };
}

/** "+$132" / "−$132" / "$0" with an explicit sign (U+2212 minus). */
export function signedCurrency(fmt: Formatters, v: number, compact = true): string {
  const abs = fmt.currency(Math.abs(v), { compact });
  if (v > 0) return `+${abs}`;
  if (v < 0) return `−${abs}`;
  return abs;
}
