import { defineConfig } from '@playwright/test'

const large_inference = !!process.env.LARGE_INFERENCE_ARTIFACT_DIR
const app_command = large_inference
    ? `VITE_HF_BASE_URL=http://127.0.0.1:5174 VITE_INFERENCE_DIAGNOSTICS=1 npm run dev -- --host 127.0.0.1`
    : `npm run dev -- --host 127.0.0.1`

export default defineConfig( {
    testDir: `./e2e`,
    timeout: 120_000,
    expect: { timeout: 60_000 },
    fullyParallel: false,
    retries: 1,
    use: {
        // Vite binds 127.0.0.1 (it may otherwise pick only [::1]); keep the
        // localhost name, which mentie needs to enable dev-level logging
        baseURL: `http://localhost:5173`,
        headless: true,
        viewport: { width: 1280, height: 720 },
        actionTimeout: 30_000,
        // GGUF model files are streamed to OPFS. Allow realistic large-model
        // tests to use the full temporary profile quota.
        // Keep Chromium's sandbox locally; Ubuntu 24.04 CI runners block the
        // unprivileged user namespaces it needs
        chromiumSandbox: !process.env.CI,
        launchOptions: {
            // Use system Chromium on Alpine (musl) where Playwright's glibc binaries won't work
            ...( process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && {
                executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
            } ),
            args: [
                `--disable-dev-shm-usage`,
                `--enable-precise-memory-info`,
                `--unlimited-storage`,
            ],
        },
    },
    webServer: [
        {
            command: app_command,
            port: 5173,
            reuseExistingServer: !process.env.CI && !large_inference,
            timeout: 30_000,
        },
        ... large_inference ? [ {
            command: `node helpers/local_model_server.mjs`,
            port: 5174,
            reuseExistingServer: false,
            timeout: 30_000,
        } ] : [],
    ],

    // Test projects — run specific subsets with --project=<name>
    projects: [

        // Fast UI tests (no inference, no model downloads)
        {
            name: `ui`,
            testMatch: /\b(chat|history|model_management|opfs_backend|query_param|settings|ux_improvements|welcome|theme_toggle|error_handling|vision_models|file_attachment)\.spec\.js$/,
        },

        // Inference tests — download real models and run WASM inference
        {
            name: `inference`,
            testMatch: /\/(inference|inference_large|inference_multimodel|model_switching|abort_generation|chat_history_with_inference|settings_with_inference|deep_link_with_inference|multi_turn_conversation|message_actions|conversation_suggestions|model_persistence|clear_all_data|speed_probe)\.spec\.js$/,
            retries: 0,
            workers: 1,
            timeout: 600_000,
        },

    ],

} )
