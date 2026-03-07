import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: 'test',
    timeout: 30_000,
    retries: 0,
    use: {
        baseURL: 'http://localhost:5173',
    },
    projects: [
        { name: 'chromium', use: { browserName: 'chromium' } },
    ],
    webServer: {
        command: 'npm run dev',
        port: 5173,
        reuseExistingServer: true,
    },
});
