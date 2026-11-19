import { describe, expect, it } from 'vitest';
import { translate, type TFunction } from '../i18n/index.tsx';
import { createFormatters } from '../i18n/format.ts';
import { backtestTrendNote } from './trendText.ts';

const tFor = (locale: 'vi' | 'en'): TFunction => (key, vars) => translate(locale, key, vars);

describe('backtest footnote of the actual vs forecast charts (demo.md §4.3 step 6)', () => {
  it('is null when the forecast line is not the backtest run', () => {
    expect(backtestTrendNote(null, tFor('en'), createFormatters('en'))).toBeNull();
    expect(backtestTrendNote({ forecast_source: null, forecast_as_of: '2025-12-22' }, tFor('en'), createFormatters('en'))).toBeNull();
  });

  it('names the past horizon and the date the future path was made', () => {
    const en = backtestTrendNote({ forecast_source: 'backtest-ensemble-v1', forecast_as_of: '2025-12-22' }, tFor('en'), createFormatters('en'));
    expect(en).toContain('evening before');
    expect(en).toContain('next 14 days');
    expect(en).not.toContain('{asOf}');
    const vi = backtestTrendNote({ forecast_source: 'backtest-ensemble-v1', forecast_as_of: '2025-12-22' }, tFor('vi'), createFormatters('vi'));
    expect(vi).toContain('tối hôm trước');
    expect(vi).toContain('22');
  });

  it('drops the future part when there is no path after the clock', () => {
    const en = backtestTrendNote({ forecast_source: 'backtest-ensemble-v1', forecast_as_of: null }, tFor('en'), createFormatters('en'));
    expect(en).toContain('evening before');
    expect(en).not.toContain('next 14 days');
  });
});
