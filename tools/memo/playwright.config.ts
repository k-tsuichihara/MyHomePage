import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser', testMatch: '**/*.spec.ts', fullyParallel: true,
  retries: 0, workers: 2, reporter: 'list', outputDir: 'test-results',
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium',
    serviceWorkers: 'block', acceptDownloads: false, trace: 'off', screenshot: 'off', video: 'off' },
  webServer: { command: 'npm run preview', url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 30000 },
});
