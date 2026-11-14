import { defineConfig } from '@playwright/test'

// Shared machines: PWA_PORT / PWA_OUT_DIR keep a run off the default preview
// port and out of dist/, which another session may be serving right now
const port = Number( process.env.PWA_PORT ) || 4173
const out_dir = process.env.PWA_OUT_DIR ? ` --outDir ${ process.env.PWA_OUT_DIR }` : ``
const url = `http://127.0.0.1:${ port }`

export default defineConfig( {
    testDir: `./pwa`,
    timeout: 120_000,
    expect: { timeout: 30_000 },
    retries: 0,
    workers: 1,
    use: {
        baseURL: url,
        headless: true,
        // Keep Chromium's sandbox locally; Ubuntu 24.04 CI runners block the
        // unprivileged user namespaces it needs
        chromiumSandbox: !process.env.CI,
        launchOptions: {
            ...process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && {
                executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
            },
            args: [ `--disable-dev-shm-usage` ],
        },
    },
    webServer: {
        command: `npm run build --${ out_dir } && npm run preview -- --host 127.0.0.1 --port ${ port } --strictPort${ out_dir }`,
        url,
        reuseExistingServer: false,
        timeout: 120_000,
    },
} )
