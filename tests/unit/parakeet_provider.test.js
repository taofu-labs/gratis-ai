import { describe, expect, test, vi } from 'vitest'

// ── Doubles: a shared ORT env, and a fromHub that snapshots it on entry ──

const ort_env = { wasm: {} }
let wasm_paths_at_load = `not called`
let hub_options = null

vi.mock( 'onnxruntime-web', () => ( { env: ort_env } ) )
vi.mock( 'parakeet.js', () => ( {
    fromHub: async ( _key, options ) => {
        hub_options = options
        wasm_paths_at_load = ort_env.wasm.wasmPaths
        return { transcribe: async () => ( { utterance_text: `` } ) }
    },
} ) )
vi.mock( '../../src/stores/db', () => ( { get_db: async () => ( { put: async () => {} } ) } ) )

const { default: ParakeetProvider } = await import( '../../src/providers/parakeet_provider' )

describe( `ParakeetProvider ORT runtime`, () => {

    // parakeet.js falls back to jsDelivr when wasmPaths is unset; voice must stay same-origin
    test( `pins ORT wasm to our own origin before parakeet.js initialises`, async () => {

        await new ParakeetProvider().load_model()

        const wasm_url = wasm_paths_at_load?.wasm
        expect( wasm_url ).toMatch( /ort-wasm-simd-threaded\.jsep.*\.wasm$/ )
        expect( new URL( wasm_url, `https://gratis-ai.com/` ).host ).toBe( `gratis-ai.com` )

    } )

    // Any webgpu mode makes parakeet.js swap in the 2.4 GB fp32 encoder, which never loads
    test( `requests the int8 WASM model the download dialog promises`, () => {

        expect( hub_options?.backend ).toBe( `wasm` )

    } )

} )
