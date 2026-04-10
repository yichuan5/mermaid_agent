import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: 'test',
    timeout: 30_000,
    retries: 0,
    use: {
        baseURL: 'http://localhost:5173',
        launchOptions: {
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        },
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
