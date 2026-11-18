import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithI18n } from '../../test/render.tsx';
import { ThemeProvider } from '../../theme/ThemeContext.tsx';
import { WhatIfPanel } from './WhatIfPanel.tsx';
import type { WhatIfResponse } from '../../services/reportsApi.ts';

const api = vi.hoisted(() => ({ postWhatIf: vi.fn() }));
vi.mock('../../services/reportsApi.ts', async (orig) => ({ ...(await orig<typeof import('../../services/reportsApi.ts')>()), postWhatIf: api.postWhatIf }));

const wrap = () => renderWithI18n(<ThemeProvider><WhatIfPanel storeId="CA_1" isGlobal={false} /></ThemeProvider>);

const ok = (R: number, rOptions: number[]): WhatIfResponse => ({
  source: 'simulated',
  simulated: true,
  store_id: 'CA_1',
  lead_time_days: 3,
  review_period_days: R,
  n_reviews: R === 1 ? 147 : 21,
  tau: 0.95,
  r_options: rOptions,
  policies: [],
});

const option = (name: RegExp) => screen.getAllByRole('option').find((o) => name.test(o.textContent ?? ''));
const rTrigger = () => screen.getByRole('button', { name: /review period r/i });
const pickR = (from: RegExp, to: RegExp) => {
  expect(rTrigger().textContent).toMatch(from);
  fireEvent.click(rTrigger());
  fireEvent.click(option(to)!);
};

beforeEach(() => {
  api.postWhatIf.mockReset();
  Element.prototype.scrollIntoView = vi.fn(); // jsdom has no layout
});

describe('WhatIfPanel review period R', () => {
  it('offers R = 1 and sends it when the server has not refused it yet', async () => {
    api.postWhatIf.mockResolvedValue(ok(1, [1, 7]));
    wrap();
    pickR(/^7-day$/, /^1-day$/);
    fireEvent.click(screen.getByRole('button', { name: /run the simulation|run/i }));
    await waitFor(() => expect(api.postWhatIf).toHaveBeenCalledTimes(1));
    expect(api.postWhatIf.mock.calls[0][0]).toMatchObject({ store_id: 'CA_1', review_period_days: 1, lead_time_days: 3 });
    await waitFor(() => expect(rTrigger().textContent).toBe('1-day'));
    fireEvent.click(rTrigger());
    expect(option(/^7-day$/)?.className).not.toContain('disabled');
  });

  it('shows the server message and disables R = 1 when r_options exclude it', async () => {
    api.postWhatIf.mockRejectedValue({
      kind: 'validation',
      status: 422,
      code: 'unsupported_review_period',
      detail: 'R = 1 is not supported',
      message: 'R = 1 is not supported',
      data: { reason_code: 'unsupported_review_period', r_options: [7], review_period_days: 1, lead_time_days: 3 },
    });
    wrap();
    pickR(/^7-day$/, /^1-day$/);
    fireEvent.click(screen.getByRole('button', { name: /run the simulation|run/i }));
    expect(await screen.findByText(/Replayable R \(days\): 7\./)).toBeTruthy();
    // the refused choice stays selectable (labelled), switching away disables it
    pickR(/1-day \(not available/, /^7-day$/);
    fireEvent.click(rTrigger());
    expect(option(/1-day \(not available/)?.className).toContain('ui-select-item--disabled');
  });
});
