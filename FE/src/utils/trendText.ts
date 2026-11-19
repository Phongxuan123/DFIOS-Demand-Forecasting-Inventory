/** Footnote of the "actual vs forecast" charts (Dashboard, Forecast Explorer overview), GET /dashboard/demand-trend. */
import type { Formatters, TFunction } from '../i18n/index.tsx';
import type { DemandTrendResponse } from '../services/dashboardApi.ts';

/**
 * In replay the BE draws the causal backtest forecasts (demo.md §4.3 step 6): up to the clock the forecast of each day
 * made the evening before, after the clock the 14-day path made at the end of `forecast_as_of`. Returns that note, or
 * null when the forecast line is not the backtest run (production / no forecast).
 */
export function backtestTrendNote(
  res: Pick<DemandTrendResponse, 'forecast_source' | 'forecast_as_of'> | null | undefined,
  t: TFunction,
  fmt: Formatters,
): string | null {
  if (!res?.forecast_source) return null;
  const past = t('dashboard.charts.trend_backtest');
  return res.forecast_as_of
    ? `${past} ${t('dashboard.charts.trend_backtest_future', { asOf: fmt.date(res.forecast_as_of) })}`
    : past;
}
