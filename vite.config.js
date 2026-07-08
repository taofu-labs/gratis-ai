import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse( readFileSync( `./package.json`, `utf-8` ) )

export default defineConfig( ( { mode } ) => {

    const env = loadEnv( mode, process.cwd(), `` )
    const app_name = env.VITE_APP_NAME || `Gratis`

    return {
        define: {
            __APP_VERSION__: JSON.stringify( pkg.version ),
        },
        plugins: [
            react(),
            VitePWA( {
                registerType: `autoUpdate`,
                includeAssets: [ `icons/*.png` ],
                manifest: {
                    name: app_name,
                    short_name: app_name,
                    description: `Private AI that runs locally on your device, presented by True Performance Network.`,
                    theme_color: `#0F1011`,
                    background_color: `#0F1011`,
                    display: `standalone`,
                    start_url: `/`,
                    icons: [
                        { src: `icons/icon-192.png`, sizes: `192x192`, type: `image/png` },
                        { src: `icons/icon-512.png`, sizes: `512x512`, type: `image/png` },
                    ],
                },
                workbox: {
                    globPatterns: [ `**/*.{js,css,html,wasm,woff2}` ],
                    // Exclude large ONNX Runtime WASM binaries from precaching — they're loaded on demand
                    globIgnores: [ `**/*ort-wasm*.wasm` ],
                    maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
                    runtimeCaching: [
                        {
                            urlPattern: /^https:\/\/huggingface\.co\/.*/,
                            handler: `CacheFirst`,
                            options: {
                                cacheName: `hf-model-cache`,
                                expiration: { maxEntries: 5, maxAgeSeconds: 30 * 24 * 60 * 60 },
                                cacheableResponse: { statuses: [ 0, 200 ] },
                                rangeRequests: true,
                            },
                        },
                    ],
                },
            } ),
        ],
        resolve: {
            alias: {
                // wllama package has main: "index.js" but built output is in esm/
                '@wllama/wllama': path.resolve( `node_modules/@wllama/wllama/esm/index.js` ),
            },
        },
        server: {
            port: 5173,
            // COOP + COEP headers enable SharedArrayBuffer, required for multi-threaded WASM inference
            headers: {
                'Cross-Origin-Opener-Policy': `same-origin`,
                'Cross-Origin-Embedder-Policy': `require-corp`,
            },
        },
        preview: {
            headers: {
                'Cross-Origin-Opener-Policy': `same-origin`,
                'Cross-Origin-Embedder-Policy': `require-corp`,
            },
        },
    }

} )
