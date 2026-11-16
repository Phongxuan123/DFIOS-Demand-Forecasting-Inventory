import { afterEach, describe, expect, it, vi } from 'vitest';
import { THETA_LIMITS, distinctX, thetaDomain } from './chartScale.ts';
import { DEFAULT_NOTIFS, NOTIF_KEY, NOTIF_PREFS_EVENT, readNotifPrefs, writeNotifPrefs } from './notifyPrefs.ts';
import { WHAT_IF_DEFAULTS, availabilityRatio, toWhatIfRequest, validateWhatIf, whatIfHighlights } from './whatIf.ts';
import { isWhatIfResponse, type WhatIfPolicyResult } from '../services/reportsApi.ts';
import { auditOutcome } from '../services/settingsApi.ts';
import { apiErrorMessage, extractCodeAndData } from '../services/apiClient.ts';
import { clearSession, storeSession } from '../services/session.ts';

describe('thetaDomain (U-14)', () => {
  it('is tight around a small drift and keeps zero in view', () => {
    const [lo, hi] = thetaDomain([0.091, 0.07, 0.05, 0.015]);
    expect(lo).toBeLessThanOrEqual(0);
    expect(lo).toBeGreaterThanOrEqual(-0.1);
    // a series well above 0 but close to it is anchored at 0
    expect(thetaDomain([0.2, 0.25])[0]).toBe(0);
    expect(hi).toBeLessThanOrEqual(0.2);
    expect(hi).toBeGreaterThan(0.091);
  });

  it('never exceeds the controller limits', () => {
    const [lo, hi] = thetaDomain([-1.9, 1.95]);
    expect(lo).toBeGreaterThanOrEqual(THETA_LIMITS[0]);
    expect(hi).toBeLessThanOrEqual(THETA_LIMITS[1]);
  });

  it('gives a visible band for a flat line and ignores nulls', () => {
    const [lo, hi] = thetaDomain([0.39, null, 0.39, undefined]);
    expect(hi - lo).toBeGreaterThanOrEqual(0.2);
    expect(lo).toBeLessThan(0.39);
    expect(hi).toBeGreaterThan(0.39);
  });

  it('has a sane default without data', () => {
    expect(thetaDomain([])).toEqual([-0.5, 0.5]);
  });

  it('counts distinct x positions', () => {
    expect(distinctX([{ k: 1 }, { k: 1 }, { k: 2 }], (r) => r.k)).toBe(2);
  });
});

describe('notification preferences (read by the bell)', () => {
  afterEach(() => localStorage.removeItem(NOTIF_KEY));

  it('defaults to everything on and tolerates corrupt storage', () => {
    expect(readNotifPrefs()).toEqual(DEFAULT_NOTIFS);
    localStorage.setItem(NOTIF_KEY, '{not json');
    expect(readNotifPrefs()).toEqual(DEFAULT_NOTIFS);
  });

  it('ignores unknown keys and non-boolean values (the old "system" switch is gone)', () => {
    localStorage.setItem(NOTIF_KEY, JSON.stringify({ stock: false, replenishment: 'yes', system: false }));
    expect(readNotifPrefs()).toEqual({ stock: false, replenishment: true });
  });

  it('persists and notifies the bell in the same tab', () => {
    const seen = vi.fn();
    window.addEventListener(NOTIF_PREFS_EVENT, seen);
    writeNotifPrefs({ stock: false, replenishment: true });
    window.removeEventListener(NOTIF_PREFS_EVENT, seen);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(readNotifPrefs()).toEqual({ stock: false, replenishment: true });
  });

  it('keeps one entry per account and survives a login (R5F-08)', () => {
    storeSession('tok-a', { id: 'user-a', email: 'a@x.test' });
    writeNotifPrefs({ stock: false, replenishment: false });
    clearSession(); // logout / login purge
    storeSession('tok-b', { id: 'user-b', email: 'b@x.test' });
    expect(readNotifPrefs()).toEqual(DEFAULT_NOTIFS); // another account: its own defaults
    storeSession('tok-a', { id: 'user-a', email: 'a@x.test' });
    expect(readNotifPrefs()).toEqual({ stock: false, replenishment: false });
    clearSession();
  });
});

describe('endpoint-scoped error codes (R5F-09)', () => {
  it('looks up a what-if code under its prefix only', () => {
    const err = { kind: 'validation', status: 422, message: 'x', detail: 'Raw reason', code: 'insufficient_data' };
    const t = ((k: string) => k) as never;
    // without the prefix the generic code is unknown -> the server's own text; with it -> the what-if sentence
    expect(apiErrorMessage(err, t)).toBe('Raw reason');
    const scoped = apiErrorMessage(err, t, 'whatif');
    expect(scoped).not.toBe('Raw reason');
    expect(scoped.length).toBeGreaterThan(40);
  });
});

describe('what-if form (FR10)', () => {
  it('accepts the A3 defaults and builds the request with numbers', () => {
    expect(validateWhatIf(WHAT_IF_DEFAULTS)).toEqual({});
    expect(toWhatIfRequest('CA_1', WHAT_IF_DEFAULTS)).toEqual({
      store_id: 'CA_1',
      lead_time_days: 3,
      review_period_days: 7,
      holding_rate: 0.002,
      stockout_penalty_rate: 0.35,
      order_cost: 2,
    });
  });

  it('flags missing and out-of-range values like the BE schema', () => {
    const errs = validateWhatIf({ L: '5', R: '14', h: '', b: '11', c: '-1' });
    expect(errs).toEqual({ L: 'range', R: 'range', h: 'required', b: 'range', c: 'range' });
  });

  it('accepts a decimal comma', () => {
    expect(validateWhatIf({ ...WHAT_IF_DEFAULTS, h: '0,003' })).toEqual({});
    expect(toWhatIfRequest('CA_1', { ...WHAT_IF_DEFAULTS, h: '0,003' }).holding_rate).toBe(0.003);
  });

  const policy = (key: string, cost: number, av: number | null): WhatIfPolicyResult => ({
    policy_key: key,
    overall: { total_cost: cost, holding_cost: 0, shortage_cost: 0, ordering_cost: 0, orders: 0, availability: av },
    by_class: [],
  });

  it('highlights the cheapest and the best-service policy', () => {
    expect(whatIfHighlights([policy('current', 120, 0.99), policy('raw_quantile', 100, 0.97)])).toEqual({ cheapest: 'raw_quantile', bestService: 'current' });
  });

  it('does not highlight a single policy', () => {
    expect(whatIfHighlights([policy('current', 1, 1)])).toEqual({ cheapest: null, bestService: null });
  });

  it('reads availability from either field', () => {
    expect(availabilityRatio({ availability: 0.95 })).toBe(0.95);
    expect(availabilityRatio({ availability: null, availability_pct: 95 })).toBe(0.95);
    expect(availabilityRatio({})).toBeNull();
  });

  it('rejects a malformed response instead of rendering it', () => {
    expect(isWhatIfResponse(null)).toBe(false);
    expect(isWhatIfResponse({ policies: [{ foo: 1 }] })).toBe(false);
    expect(isWhatIfResponse({ policies: [policy('current', 1, 1)] })).toBe(true);
  });
});

describe('backend shapes handled defensively', () => {
  it('audit outcome prefers a stored status over the derived result', () => {
    expect(auditOutcome({ status: 'FAILURE', result: 'SUCCESS' })).toBe('FAILURE');
    expect(auditOutcome({ result: 'SUCCESS' })).toBe('SUCCESS');
    expect(auditOutcome({})).toBeNull();
    // BE round 5: legacy rows are "unknown" -> no badge, never shown as success
    expect(auditOutcome({ result: 'unknown' })).toBeNull();
  });

  it('extracts a stable code from structured or flat error bodies', () => {
    expect(extractCodeAndData({ detail: { reason_code: 'unsupported_review_period', reason: 'x', supported_review_period_days: [7] } })).toEqual({
      code: 'unsupported_review_period',
      data: { reason_code: 'unsupported_review_period', reason: 'x', supported_review_period_days: [7] },
    });
    expect(extractCodeAndData({ detail: 'text', code: 'bad_credentials' })).toEqual({ code: 'bad_credentials', data: undefined });
    expect(extractCodeAndData({ detail: 'text' })).toEqual({ code: undefined, data: undefined });
    expect(extractCodeAndData(null)).toEqual({});
  });
});
