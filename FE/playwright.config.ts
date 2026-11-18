/**
 * E2E (demo.md §8: Playwright runs steps 2, 6 and 7 of the demo script) against a RUNNING stack:
 *   BE  : uvicorn on the LOCAL demo DB (never the shared Supabase: the specs reset the simulation clock)
 *   FE  : `npm run dev` (Vite proxies /api to the BE)
 *
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD   required (specs skip without them)
 *   E2E_PLANNER_EMAIL / E2E_PLANNER_PASSWORD optional (role checks of the Planner)
 *   E2E_BASE_URL (default http://localhost:5173), E2E_API_URL (default http://localhost:8000/api/v1)
 *   PW_CHROMIUM_PATH: optional browser executable; otherwise run `npx playwright install chromium` once
 *
 *   npm run e2e
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    locale: 'vi-VN',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
});
