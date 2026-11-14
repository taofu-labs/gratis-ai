import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { build_constants } from './vite.config.js'

export default defineConfig( {

    // Main process
    main: {
        plugins: [ externalizeDepsPlugin() ],
        define: {
            __GITHUB_REPO__: JSON.stringify( process.env.VITE_GITHUB_REPO || `` ),
        },
        build: {
            rollupOptions: {
                input: {
                    main: path.resolve( `electron/main.js` ),
                    inference_worker: path.resolve( `electron/inference_worker.js` ),
                },
            },
        },
    },

    // Preload script — must be CJS for Electron's contextIsolation
    preload: {
        plugins: [ externalizeDepsPlugin() ],
        build: {
            rollupOptions: {
                input: path.resolve( `electron/preload.js` ),
                output: { format: `cjs` },
            },
        },
    },

    // Renderer (the React app)
    renderer: {
        plugins: [ react() ],
        root: `.`,
        // Without these the desktop Settings footer reads "vdev · dev"
        define: build_constants,
        build: {
            rollupOptions: {
                input: path.resolve( `index.html` ),
            },
        },
        server: {
            port: 5173,
            headers: {
                'Cross-Origin-Opener-Policy': `same-origin`,
                'Cross-Origin-Embedder-Policy': `require-corp`,
            },
        },
    },

} )
