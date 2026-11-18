/**
 * Demo script (demo.md §7) steps 2, 6 and 7, driven through the UI on a local stack. The clock is reset to its start
 * first, so the run is repeatable; every UI action is then checked against the API.
 */
import { expect, test } from '@playwright/test';
import { addDays, ADMIN, api, choose, getClock, hasAdmin, login, STORE, API_URL } from './helpers';

test.describe.configure({ mode: 'serial' });
test.skip(!hasAdmin, 'set E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD to run the E2E specs');

test.beforeAll(async () => {
  const ctx = await api(ADMIN);
  const res = await ctx.post(`${API_URL}/clock/reset`, { data: { store_id: STORE } });
  expect(res.ok(), await res.text()).toBeTruthy();
  await ctx.dispose();
});

test('step 2 - sign in and see the dashboard KPIs and the simulation clock', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/');
  await expect(page.locator('.dash-clock-date')).toBeVisible();
  await expect(page.locator('.dash-clock-date')).not.toHaveText('');
  // Admin sees the clock controls
  await expect(page.locator('#dash-clock-unit')).toBeVisible();
});

test('step 7 - advance one review period, then the batch history records the run', async ({ page }) => {
  const ctx = await api(ADMIN);
  const before = await getClock(ctx);

  await login(page, ADMIN);
  await page.goto('/');
  await choose(page, 'dash-clock-unit', /kỳ review|Review periods/i);
  await choose(page, 'dash-clock-reviews', '1');
  await page.locator('.dash-clock-btn').click();
  // confirm dialog
  await page.getByRole('alertdialog').getByRole('button', { name: /Tua đồng hồ|Advance clock/ }).click();

  await expect
    .poll(async () => (await getClock(ctx)).current_date, { timeout: 150_000, intervals: [2_000] })
    .not.toBe(before.current_date);
  const after = await getClock(ctx);
  expect(after.current_date > before.current_date).toBeTruthy();
  expect(after.current_date <= addDays(before.current_date, before.review_period_days)).toBeTruthy();

  await page.goto('/batch-runs');
  const firstAdvance = page.locator('tbody tr', { hasText: 'ADVANCE' }).first();
  await expect(firstAdvance).toBeVisible();
  await expect(firstAdvance).toContainText(/Thành công|Succeeded/);
  await ctx.dispose();
});

test('step 6 - planner work on this review: filter pending, adjust with a reason, approve, export CSV', async ({ page }) => {
  const ctx = await api(ADMIN);

  // Admin advances one review in "Planner approves" mode: the clock stops at the review day and its proposals wait
  await login(page, ADMIN);
  await page.goto('/');
  await choose(page, 'dash-clock-unit', /kỳ review|Review periods/i);
  await choose(page, 'dash-clock-reviews', '1');
  await choose(page, 'dash-clock-mode', /Planner duyệt|Planner approves/);
  await page.locator('.dash-clock-btn').click();
  await page.getByRole('alertdialog').getByRole('button', { name: /Tua đồng hồ|Advance clock/ }).click();
  const openPending = page.getByRole('button', { name: /Xem đề xuất chờ duyệt|Open pending proposals/ });
  await expect(openPending).toBeVisible({ timeout: 150_000 });

  const pending = await ctx.get(`${API_URL}/replenishments`, { params: { store_id: STORE, status: 'PENDING', limit: 2 } });
  expect(pending.ok()).toBeTruthy();
  const items = (await pending.json()).items as Array<{ id: string; item_id: string; final_qty: number }>;
  test.skip(items.length < 2, 'the review produced fewer than 2 proposals');

  // the banner link opens the list already filtered on PENDING
  await openPending.click();
  await expect(page).toHaveURL(/\/replenishment\?status=PENDING/);
  const row = page.locator('tbody tr', { hasText: items[0].item_id }).first();
  await expect(row).toBeVisible();

  // adjust: new quantity + mandatory reason; the server keeps both the proposal and the planner's number
  const newQty = Math.max(1, Math.round(items[0].final_qty) + 1);
  await row.getByRole('button', { name: /Điều chỉnh|Adjust/ }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel(/Số lượng đặt|Order quantity/).fill(String(newQty));
  await dlg.getByLabel(/^Lý do|^Reason/).fill('E2E: kiểm kê thực tế');
  await dlg.getByRole('button', { name: /Lưu số lượng|Save quantity/ }).click();
  await expect
    .poll(async () => {
      const r = await ctx.get(`${API_URL}/replenishments`, { params: { store_id: STORE, item_id: items[0].item_id, limit: 5 } });
      return ((await r.json()).items as Array<{ id: string; final_qty: number }>).find((x) => x.id === items[0].id)?.final_qty;
    })
    .toBe(newQty);

  // approve the second proposal
  const row2 = page.locator('tbody tr', { hasText: items[1].item_id }).first();
  await row2.getByRole('button', { name: /^Duyệt$|^Approve$/ }).click();
  const confirm = page.getByRole('alertdialog');
  if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: /^Duyệt$|^Approve$/ }).click();
  await expect
    .poll(async () => {
      const r = await ctx.get(`${API_URL}/replenishments`, { params: { store_id: STORE, item_id: items[1].item_id, limit: 5 } });
      return ((await r.json()).items as Array<{ id: string; status: string }>).find((x) => x.id === items[1].id)?.status;
    })
    .toBe('APPROVED');

  // export CSV
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Xuất CSV$|^Export CSV$/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.csv$/i);
  await ctx.dispose();
});
