import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a running stack (API, worker, web). Locally: `pnpm dev`, then
 * `pnpm e2e`. CI starts production builds first. Data is created by global-setup through the
 * real API, so the tests never touch shared fixtures.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    locale: 'ru-RU',
    timezoneId: 'Asia/Almaty',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
});
