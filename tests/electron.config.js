import { defineConfig } from '@playwright/test'

export default defineConfig( {
    testDir: `./electron`,
    timeout: 120_000,
    expect: { timeout: 60_000 },
    fullyParallel: false,
    retries: 1,

    // Test projects — run specific subsets with --project=<name>
    projects: [

        // Smoke tests — app launches, API exposed, no inference
        {
            name: `smoke`,
            testMatch: /\bsmoke\.spec\.js$/,
        },

        // Inference tests — native node-llama-cpp inference through Electron
        {
            name: `inference`,
            testMatch: /\b(inference|multi_architecture|model_management|electron_chat_history|electron_model_switching|electron_settings_inference|vision_sidecar)\.spec\.js$/,
            retries: 0,
            workers: 1,
            timeout: 600_000,
        },

    ],

} )
