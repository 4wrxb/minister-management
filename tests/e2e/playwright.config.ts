import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for integration / E2E tests.
 *
 * Tests run against the Docker container started by docker compose.
 * Set BASE_URL env var to override (default: http://localhost:8080).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  workers: 1, // serial: prevents test pollution (shared Docker container)

  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:8080',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  reporter: [['list'], ['html', { open: 'never' }]],
})
