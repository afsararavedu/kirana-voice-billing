import { defineConfig, devices } from '@playwright/test';

// Isolated ports so e2e never touches the dev DB/API.
const WEB_PORT = 5174;

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'npm run e2e:server -w @kirana/api',
      cwd: '../..',
      url: 'http://localhost:4100/api/v1/health/ready',
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: 'npx vite --mode e2e',
      url: `http://localhost:${WEB_PORT}`,
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
