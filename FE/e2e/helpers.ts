import { expect, request, type APIRequestContext, type Page } from '@playwright/test';

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1';
export const STORE = process.env.E2E_STORE ?? 'CA_1';

export const ADMIN = { email: process.env.E2E_ADMIN_EMAIL ?? '', password: process.env.E2E_ADMIN_PASSWORD ?? '' };
export const PLANNER = { email: process.env.E2E_PLANNER_EMAIL ?? '', password: process.env.E2E_PLANNER_PASSWORD ?? '' };
export const hasAdmin = !!(ADMIN.email && ADMIN.password);
export const hasPlanner = !!(PLANNER.email && PLANNER.password);

/** Sign in through the real login form and wait to leave /login. */
export async function login(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(who.email);
  await page.locator('input[type="password"]').fill(who.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}

/** Authenticated API context (used for setup and to check what the UI did, never to replace the UI step). */
export async function api(who: { email: string; password: string }): Promise<APIRequestContext> {
  const anon = await request.newContext();
  const res = await anon.post(`${API_URL}/auth/login`, { data: { email: who.email, password: who.password } });
  expect(res.ok(), await res.text()).toBeTruthy();
  const token = (await res.json()).access_token as string;
  await anon.dispose();
  return request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
}

export interface Clock {
  current_date: string;
  start_date: string;
  review_period_days: number;
}

export async function getClock(ctx: APIRequestContext): Promise<Clock> {
  const res = await ctx.get(`${API_URL}/clock`, { params: { store_id: STORE } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

/** Pick an option of the custom <Select> (button trigger + role=option list). */
export async function choose(page: Page, triggerId: string, optionText: string | RegExp) {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole('option', { name: optionText }).click();
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
