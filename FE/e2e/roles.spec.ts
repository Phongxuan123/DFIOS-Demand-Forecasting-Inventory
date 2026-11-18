/** Role checks (demo.md §6.1): what Admin and Planner see. */
import { expect, test } from '@playwright/test';
import { ADMIN, hasAdmin, hasPlanner, login, PLANNER } from './helpers';

test('admin reaches Batch history and Model versions', async ({ page }) => {
  test.skip(!hasAdmin, 'set E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD');
  await login(page, ADMIN);
  await page.goto('/batch-runs');
  await expect(page.getByRole('heading', { name: /Lịch sử batch|Batch history/ })).toBeVisible();
  await page.goto('/model-versions');
  await expect(page.getByRole('heading', { name: /Phiên bản mô hình|Model versions/ })).toBeVisible();
  await page.goto('/abc-xyz');
  await expect(page.getByRole('heading', { name: /Chính sách đang áp dụng|Policy in force/ })).toBeVisible();
});

test('planner sees proposals and forecasts but no clock controls, batch history or model versions', async ({ page }) => {
  test.skip(!hasPlanner, 'set E2E_PLANNER_EMAIL / E2E_PLANNER_PASSWORD (BE: PLANNER_PASSWORD + scripts/load_users.py)');
  await login(page, PLANNER);
  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('link', { name: /Đề xuất|Replenishment/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: /Khám phá dự báo|Forecast/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: /Lịch sử batch|Batch history/ })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: /Phiên bản mô hình|Model versions/ })).toHaveCount(0);
  await page.goto('/');
  await expect(page.locator('#dash-clock-unit')).toHaveCount(0);
  await page.goto('/replenishment');
  await expect(page.getByRole('button', { name: /Duyệt|Approve/ }).first()).toBeVisible();
});
