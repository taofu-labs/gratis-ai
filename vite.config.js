import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'

const pkg = JSON.parse( readFileSync( `./package.json`, `utf-8` ) )

export default defineConfig( ( { mode } ) => {

    const env = loadEnv( mode, process.cwd(), `` )
    const app_name = env.VITE_APP_NAME || `gratisAI`

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
                    description: `Run AI locally. Your data never leaves your device.`,
                    theme_color: `#1a1a2e`,
                    background_color: `#1a1a2e`,
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
                    // The self-hosted wasm32 fallback is ~16 MiB.
                    maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
                },
            } ),
        ],
        server: {
            port: 5173,
            // Memory64 uses shared WASM memory even when inference is single-threaded.
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
