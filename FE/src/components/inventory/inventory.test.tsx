import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithI18n } from '../../test/render.tsx';
import { ForecastWindowView, WindowBox } from './ForecastWindowView.tsx';
import { InventorySummaryTiles, StockStatusPill } from './InventoryParts.tsx';
import type { ForecastWindowResponse } from '../../services/inventoryScreenApi.ts';

const sample = (over: Partial<ForecastWindowResponse> = {}): ForecastWindowResponse => ({
  store_id: 'CA_1',
  item_id: 'FOODS_1_001',
  review_date: '2016-04-25',
  review_date_source: 'sim_clock',
  lead_time_days: 3,
  review_period_days: 7,
  horizon_days: 10,
  distribution: {
    model_run_id: 'backtest-ensemble-v1',
    route: 'c',
    stored: false,
    point_source: 'backtest',
    n_residuals: 40,
    point_window: 20,
    min_level: 0.05,
    q_min: 12,
    q50: 19,
    q80: 24,
    q90: 27,
    q95: 31.5,
    q99: 38,
    q_levels: { '0.05': 12, '0.5': 19, '0.95': 31.5 },
  },
  error_stats: {
    lookback_days: 182,
    unit: 'window_total_H10',
    model_source: 'forecast_backtest',
    n_windows: 24,
    scale: 9.5,
    scale_days: 364,
    reason_code: null,
    methods: [
      { method: 'model', n_windows: 24, mae: 5.1, mase: 0.537, bias: 0.4, bias_pct: 0.02 },
      { method: 'snaive', n_windows: 24, mae: 7.2, mase: 0.758, bias: -0.1, bias_pct: -0.005 },
      { method: 'naive', n_windows: 24, mae: 9, mase: 0.947, bias: 1, bias_pct: 0.05 },
      { method: 'ma28', n_windows: 24, mae: 6, mase: 0.632, bias: 0.2, bias_pct: 0.01 },
    ],
  },
  policy: {
    segment: 'CZ',
    class_source: 'ground_truth',
    tau: 0.95,
    q_hat_tau: 31.5,
    m_g: 0.2,
    kappa_g: 1.5,
    theta_g: 0.1,
    mean_daily_56: 2,
    eoq: 22.36,
    s: 43,
    S: 77,
    price: 4,
    stored_s: 41,
    stored_S: 70,
  },
  notes: ['note one'],
  ...over,
});

describe('WindowBox', () => {
  it('lists every stored level and the point forecast', () => {
    renderWithI18n(<WindowBox data={sample()} />);
    expect(screen.getByText('Lowest (Q0.05)')).toBeTruthy();
    expect(screen.getByText('Q50')).toBeTruthy();
    expect(screen.getByText('Q99')).toBeTruthy();
    expect(screen.getByText('Q̂(0.95)')).toBeTruthy();
    expect(screen.getByText('31.5')).toBeTruthy();
    expect(screen.getByText('Point forecast F̂')).toBeTruthy();
  });

  it('skips missing levels instead of inventing them', () => {
    const d = sample();
    renderWithI18n(<WindowBox data={{ ...d, distribution: { ...d.distribution, q99: null, q_min: null } }} />);
    expect(screen.queryByText('Q99')).toBeNull();
    expect(screen.queryByText(/Lowest/)).toBeNull();
  });
});

describe('ForecastWindowView', () => {
  it('shows the error table, the implied s/S and the stored s/S', () => {
    renderWithI18n(<ForecastWindowView data={sample()} />);
    expect(screen.getByText('Model (Ensemble)')).toBeTruthy();
    expect(screen.getByText('SNaive (weekly)')).toBeTruthy();
    expect(screen.getByText('0.537')).toBeTruthy();
    expect(screen.getByText('43 / 77')).toBeTruthy();
    expect(screen.getByText('Stored s/S: 41 / 70')).toBeTruthy();
    expect(screen.getByText('Computed on the fly (not stored)')).toBeTruthy();
    expect(screen.getByText('Why not add up daily quantiles?')).toBeTruthy();
  });

  it('explains why error stats are missing', () => {
    const d = sample();
    renderWithI18n(
      <ForecastWindowView
        data={{ ...d, error_stats: { ...d.error_stats, reason_code: 'no_model_windows', n_windows: 0, methods: [] } }}
      />,
    );
    expect(screen.getByText(/has no window forecast/)).toBeTruthy();
  });

  it('renders in Vietnamese', () => {
    renderWithI18n(<ForecastWindowView data={sample()} />, 'vi');
    expect(screen.getByText('Vì sao không cộng quantile ngày?')).toBeTruthy();
  });
});

describe('inventory parts', () => {
  it('labels every stock status', () => {
    renderWithI18n(
      <>
        <StockStatusPill status="below_s" />
        <StockStatusPill status="ok" />
        <StockStatusPill status="above_S" />
        <StockStatusPill status="no_params" />
      </>,
    );
    for (const label of ['Below s', 'Within (s, S)', 'Above S', 'No parameters']) expect(screen.getByText(label)).toBeTruthy();
  });

  it('shows the store summary', () => {
    renderWithI18n(
      <InventorySummaryTiles
        summary={{
          sku_count: 120,
          below_s_count: 7,
          above_S_count: 3,
          no_params_count: 2,
          total_stock_value: 1234.5,
          priced_sku_count: 118,
          units_in_transit: 45,
          skus_in_transit: 9,
          orders_in_transit: 6,
        }}
      />,
    );
    expect(screen.getByText('SKUs below s')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.getByText('45 units in transit for 9 SKUs')).toBeTruthy();
  });
});
