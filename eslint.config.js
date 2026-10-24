import { eslint_config } from 'airier'

export default [
    ...eslint_config,
    {
        languageOptions: {
            globals: {
                // Injected by Vite `define` at build time
                __APP_VERSION__: `readonly`,
                __COMMIT_HASH__: `readonly`,
            },
        },
    },
]
