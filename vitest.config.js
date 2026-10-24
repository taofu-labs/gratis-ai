import { defineConfig, loadEnv } from 'vite'
import { configDefaults } from 'vitest/config'

export default defineConfig( ( { mode } ) => {

    const env = loadEnv( mode, process.cwd(), `` )

    return {
        test: {
            // Load .env.development variables
            env,
            testTimeout: 600_000,
            hookTimeout: 120_000,
            // Vendored upstream sources (llama.cpp for the mobile builds) carry their own tests
            exclude: [ ...configDefaults.exclude, `vendor/**`, `mobile/**` ],
        },
    }

} )
