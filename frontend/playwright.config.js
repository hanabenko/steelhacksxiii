import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  timeout: 30000,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', headless: true, viewport: { width: 1440, height: 1050 }, channel: process.env.PLAYWRIGHT_CHANNEL || 'chromium', launchOptions: { args: ['--enable-unsafe-swiftshader'] }, screenshot: 'only-on-failure' },
  webServer: { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
});
