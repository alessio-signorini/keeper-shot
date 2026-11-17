import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  use: { baseURL: 'http://localhost:4173/', serviceWorkers: 'allow' },
  projects: [
    {
      name: 'chromium',
      // docker's small /dev/shm and the GPU process make Chromium crash on large photos in containers
      use: { browserName: 'chromium', launchOptions: { args: ['--disable-dev-shm-usage', '--disable-gpu'] } },
    },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
    timeout: 300_000,
  },
});
