import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithI18n } from '../../test/render.tsx';
import { ThemeProvider } from '../../theme/ThemeContext.tsx';
import { ControllerPanel } from './ControllerPanel.tsx';
import { MODEL_SWITCH_DATE, defaultEventDate } from './metricsDefaults.ts';
import { ForecastQualityPanel } from './ForecastQualityPanel.tsx';
import type { ControllerMetrics, ForecastQuality } from '../../services/metricsApi.ts';

const api = vi.hoisted(() => ({ getForecastQuality: vi.fn(), getControllerMetrics: vi.fn() }));
vi.mock('../../services/metricsApi.ts', () => api);
vi.mock('../../context/AuthContext.tsx', () => ({ useAuth: () => ({ user: { role: 'ADMIN' } }) }));

const okQuality: ForecastQuality = {
  status: 'ok',
  store_id: 'CA_1',
  model_run_id: 'run',
  horizon_days: 10,
  coverage: { '0.5': 0.52, '0.8': 0.81, '0.9': 0.91, '0.95': 0.948, '0.99': 0.989 },
  spl: 0.123,
  mase_median: 0.812,
  median_bias_pct: -1.5,
  n_origins: 60,
  n_items_used: 500,
  n_windows: 30000,
};

const controller = (over: Partial<ControllerMetrics> = {}): ControllerMetrics => ({
  store_id: 'CA_1',
  target: 0.95,
  event_date: null,
  n_complete_cycles: 40,
  overall: {
    n_windows: 37,
    gap_mean: 0.01,
    min_class_csl: 0.931,
    feasible: false,
    rolling_violation: 0.12,
    rolling_worst: 0.04,
    recovery_days: null,
    recovery_censored: true,
    n_boundary_classes: 1,
  },
  classes: {
    AX: { status: 'Active', theta: 0.04, n_sku: 10, availability: 0.96, rolling_violation: 0.05, violating_windows: 2, recovery_days: 21 },
    CZ: { status: 'Boundary', theta: 2, n_sku: 5, availability: 0.9, rolling_violation: 0.4, violating_windows: 9, recovery_days: null },
    BY: { status: 'Warm-up', theta: null, n_sku: 0 },
  },
  ...over,
});

const wrap = (ui: React.ReactElement) => renderWithI18n(<ThemeProvider>{ui}</ThemeProvider>);

beforeEach(() => {
  api.getForecastQuality.mockReset();
  api.getControllerMetrics.mockReset();
});

describe('ForecastQualityPanel', () => {
  it('renders the tiles and chart when status is ok', async () => {
    api.getForecastQuality.mockResolvedValue(okQuality);
    wrap(<ForecastQualityPanel storeId="CA_1" />);
    expect(await screen.findByText('Q0.95 coverage')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('94.8%')).toBeTruthy());
    expect(screen.getByText('0.123')).toBeTruthy();
    expect(screen.getByText('0.812')).toBeTruthy();
    expect(screen.getByText('Coverage by quantile level')).toBeTruthy();
  });

  it('shows the backend message and no chart for no_data', async () => {
    api.getForecastQuality.mockResolvedValue({ status: 'no_data', detail: 'no window quantiles for this store / horizon', store_id: 'CA_1', model_run_id: null, horizon_days: 10 });
    wrap(<ForecastQualityPanel storeId="CA_1" />);
    expect(await screen.findByText('no window quantiles for this store / horizon')).toBeTruthy();
    expect(screen.queryByText('Coverage by quantile level')).toBeNull();
    expect(screen.queryByText('94.8%')).toBeNull();
  });

  it('shows an error state with retry', async () => {
    api.getForecastQuality.mockRejectedValue({ response: { status: 500, data: { detail: 'boom' } }, isAxiosError: true });
    wrap(<ForecastQualityPanel storeId="CA_1" />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });
});

describe('ControllerPanel', () => {
  it('renders per-class status pills, overall tiles and not recovered', async () => {
    api.getControllerMetrics.mockResolvedValue(controller());
    wrap(<ControllerPanel storeId="CA_1" clockDate="2015-12-20" />);
    expect(await screen.findByText('AX')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Boundary')).toBeTruthy();
    expect(screen.getByText('Warm-up')).toBeTruthy();
    expect(screen.getByText('12.0%')).toBeTruthy();
    expect(screen.getByText('93.1%')).toBeTruthy();
    expect(screen.getAllByText('not recovered').length).toBeGreaterThan(0);
    expect(api.getControllerMetrics).toHaveBeenCalledWith('CA_1', MODEL_SWITCH_DATE, expect.anything());
  });

  it('defaults the event date only when the clock is past the model switch', () => {
    expect(defaultEventDate('2015-11-23')).toBe('');
    expect(defaultEventDate('2015-11-24')).toBe(MODEL_SWITCH_DATE);
    expect(defaultEventDate(null)).toBe('');
  });

  it('sends no event date before the switch and lets the user clear it', async () => {
    api.getControllerMetrics.mockResolvedValue(controller());
    wrap(<ControllerPanel storeId="CA_1" clockDate="2015-08-01" />);
    await screen.findByText('AX');
    expect(api.getControllerMetrics).toHaveBeenLastCalledWith('CA_1', null, expect.anything());
    fireEvent.change(screen.getByLabelText('Event date'), { target: { value: '2015-12-01' } });
    await waitFor(() => expect(api.getControllerMetrics).toHaveBeenLastCalledWith('CA_1', '2015-12-01', expect.anything()));
  });

  it('shows the empty state without complete cycles', async () => {
    api.getControllerMetrics.mockResolvedValue(controller({ overall: null, n_complete_cycles: 0 }));
    wrap(<ControllerPanel storeId="CA_1" clockDate="2015-08-01" />);
    expect(await screen.findByText('No complete service cycles yet')).toBeTruthy();
  });

  it('shows a forbidden state on 403', async () => {
    api.getControllerMetrics.mockRejectedValue({ response: { status: 403, data: { detail: 'no' } }, isAxiosError: true });
    wrap(<ControllerPanel storeId="CA_1" clockDate="2015-08-01" />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
