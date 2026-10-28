import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'
import { execSync } from 'child_process'

const pkg = JSON.parse( readFileSync( `./package.json`, `utf-8` ) )

// Short hash of the build's commit; CI may build from a tarball without .git
const commit_hash = ( () => {
    if( process.env.GITHUB_SHA ) return process.env.GITHUB_SHA.slice( 0, 7 )
    try {
        return execSync( `git rev-parse --short HEAD`, { stdio: [ `ignore`, `pipe`, `ignore` ] } ).toString().trim()
    } catch {
        return `dev`
    }
} )()

export default defineConfig( ( { mode } ) => {

    const env = loadEnv( mode, process.cwd(), `` )
    const app_name = env.VITE_APP_NAME || `gratisAI`

    // `vite build --mode native` feeds the Android/iOS shells (Capacitor): the app
    // store ships updates, so no service worker caches or reloads the bundle
    const native = mode === `native`

    return {
        define: {
            __APP_VERSION__: JSON.stringify( pkg.version ),
            __COMMIT_HASH__: JSON.stringify( commit_hash ),
        },
        plugins: [
            react(),
            ! native && VitePWA( {
                registerType: `autoUpdate`,
                includeAssets: [ `icons/*.png` ],
                manifest: {
                    name: app_name,
                    short_name: app_name,
                    description: `Run AI locally. Your data never leaves your device.`,
                    theme_color: `#F7F6F2`,
                    background_color: `#F7F6F2`,
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
                    // A version bump must replace cached navigation responses even
                    // when only edge headers changed. Cross-origin isolation is a
                    // property of that cached response, not just the network route.
                    manifestTransforms: [ entries => ( {
                        manifest: entries.map( entry => entry.url === `index.html`
                            ? { ...entry, revision: `${ entry.revision }-${ pkg.version }` }
                            : entry ),
                        warnings: [],
                    } ) ],
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
