import { defineConfig } from '@playwright/test'

export default defineConfig( {
    testDir: `./e2e`,
    timeout: 120_000,
    expect: { timeout: 60_000 },
    fullyParallel: false,
    retries: 1,
    use: {
        baseURL: `http://localhost:5173`,
        headless: true,
        viewport: { width: 1280, height: 720 },
        actionTimeout: 30_000,
        // GGUF model blobs are stored in IndexedDB — allow unlimited storage
        // so large models don't hit Chromium's default quota
        launchOptions: {
            // Use system Chromium on Alpine (musl) where Playwright's glibc binaries won't work
            ...( process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && {
                executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
            } ),
            args: [ `--unlimited-storage` ],
        },
    },
    webServer: {
        command: `npm run dev`,
        port: 5173,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },

    // Test projects — run specific subsets with --project=<name>
    projects: [

        // Fast UI tests (no inference, no model downloads)
        {
            name: `ui`,
            testMatch: /\b(chat|history|model_management|query_param|settings|ux_improvements|welcome|theme_toggle|error_handling|vision_models|file_attachment)\.spec\.js$/,
        },

        // Inference tests — download real models and run WASM inference
        {
            name: `inference`,
            testMatch: /\/(inference|inference_multimodel|model_switching|abort_generation|chat_history_with_inference|settings_with_inference|deep_link_with_inference|multi_turn_conversation|message_actions|conversation_suggestions|model_persistence|clear_all_data)\.spec\.js$/,
            retries: 0,
            workers: 1,
            timeout: 600_000,
        },

        // Heavy tests — large model downloads, slow inference (nightly/optional)
        {
            name: `heavy`,
            testMatch: /\binference_mistral\.spec\.js$/,
            retries: 0,
            workers: 1,
            timeout: 2_400_000,
        },

    ],

} )
