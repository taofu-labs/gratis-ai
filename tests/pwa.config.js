import { defineConfig } from '@playwright/test'

export default defineConfig( {
    testDir: `./pwa`,
    timeout: 120_000,
    expect: { timeout: 30_000 },
    retries: 0,
    workers: 1,
    use: {
        baseURL: `http://127.0.0.1:4173`,
        headless: true,
        launchOptions: {
            ...process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && {
                executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
            },
            args: [ `--disable-dev-shm-usage` ],
        },
    },
    webServer: {
        command: `npm run build && npm run preview -- --host 127.0.0.1`,
        url: `http://127.0.0.1:4173`,
        reuseExistingServer: false,
        timeout: 120_000,
    },
} )
