/**
 * Device speed probe. Decode speed of every catalog model was measured once on
 * a reference machine (`browser_tps`); this probe times one fixed workload here
 * and on that machine, and the ratio scales the whole table to this device.
 *
 * The workload is a zero-weight skeleton of the smallest catalog model: only its
 * GGUF header is downloaded (~11 MB), no weights.
 *
 * Only relative imports: scripts/bench/speed_table loads this file raw.
 */
import { gguf_skeleton_parts, parse_gguf_header } from './gguf_skeleton.js'

// Pinned revision: the probe must stay byte-identical to what was measured
const PROBE_URL = `https://huggingface.co/tpnlabs/Qwen3.5-0.8B-TPN-GGUF/resolve/4a220e7e8b979ffa25b3c2baeca00da16613c234/Qwen3.5-0.8B-Q5_K_M.gguf`
const PROBE_LAYERS = 8
const PROBE_TOKENS = 24
const WARMUP_TOKENS = 4
const MAX_HEADER_BYTES = 64 * 1024 * 1024
const PARSE_EVERY_BYTES = 1024 * 1024
const PROBE_FILE = `speed-probe.gguf`

// Bump when the probe or the reference table changes: stored ratios reset
export const SPEED_REFERENCE_ID = `i3-1115g4-2t-2026-10-23`

// What the probe decodes at on the reference machine (scripts/bench/speed_table.mjs)
export const REFERENCE_PROBE_TPS = 5.95

/**
 * The CPU load options the app uses (wllama_provider cpu_load_options), at the
 * picker's default context. Reference and probe must load identically.
 * @param {number} n_threads
 */
export const probe_load_options = n_threads => ( {
    n_ctx: 2048,
    n_batch: 128,
    n_ubatch: 128,
    n_threads,
    n_parallel: 1,
    n_gpu_layers: 0,
    flash_attn: true,
    cache_type_k: `q8_0`,
    cache_type_v: `q8_0`,
} )

/** The app's thread count: half the cores, leaving room for the compositor. */
export const probe_threads = () => Math.min( 8, Math.max( 1, Math.floor( ( globalThis.navigator?.hardwareConcurrency || 1 ) / 2 ) ) )

/**
 * Write the skeleton to OPFS. A ~340 MB Blob can outgrow Chrome's in-memory
 * blob budget (it then reads as NotReadableError); an OPFS file lives on disk.
 * @param {Uint8Array[]} parts
 * @returns {Promise<File>}
 */
const stage_on_disk = async parts => {

    const root = await navigator.storage.getDirectory()
    const writable = await ( await root.getFileHandle( PROBE_FILE, { create: true } ) ).createWritable()
    for( const part of parts ) await writable.write( part )
    await writable.close()
    return ( await root.getFileHandle( PROBE_FILE ) ).getFile()

}

/** Delete the staged skeleton, if any. */
const discard_probe_file = () => navigator.storage?.getDirectory()
    .then( root => root.removeEntry( PROBE_FILE ) )
    .catch( () => {} )

/**
 * Download only the probe model's header and build its skeleton: on disk when
 * OPFS allows, in memory otherwise (private windows with a tiny quota).
 * @param {string} [url]
 * @returns {Promise<File>}
 */
export const fetch_probe_skeleton = async ( url = PROBE_URL ) => {

    // The header length is unknown up front: stream, and stop once it parses
    const response = await fetch( url, { headers: { Range: `bytes=0-${ MAX_HEADER_BYTES - 1 }` } } )
    if( response.status !== 206 ) throw new Error( `Speed probe needs range requests (HTTP ${ response.status })` )
    const file_bytes = Number( response.headers.get( `Content-Range` )?.split( `/` )[ 1 ] )
    const reader = response.body.getReader()

    const head = new Uint8Array( MAX_HEADER_BYTES )
    let received = 0
    let parsed_at = 0

    while( true ) {

        const { done, value } = await reader.read()
        if( value ) {
            head.set( value, received )
            received += value.length
        }
        if( !done && received - parsed_at < PARSE_EVERY_BYTES ) continue

        parsed_at = received
        try {
            const header = parse_gguf_header( head.subarray( 0, received ) )
            reader.cancel().catch( () => {} )
            const parts = gguf_skeleton_parts( header, file_bytes, PROBE_LAYERS )
            return await stage_on_disk( parts ).catch( () => new File( parts, PROBE_FILE ) )
        } catch ( error ) {
            if( !( error instanceof RangeError ) || done ) throw error
        }

    }

}

/**
 * Greedy decode of `tokens` tokens, never stopping at end-of-text (zero
 * weights would). Returns llama.cpp's own decode rate.
 * @param {import('wllama64').Wllama} wllama - With a model loaded
 * @param {number} tokens
 * @returns {Promise<number>} tokens per second
 */
export const time_decode = async ( wllama, tokens ) => {

    let predicted_per_second = 0
    const stream = await wllama.createCompletion( {
        prompt: `Once upon a time, in a small village by the sea,`,
        max_tokens: tokens,
        temperature: 0,
        seed: 1,
        ignore_eos: true,
        cache_prompt: false,
        stream: true,
    } )
    for await ( const { timings } of stream ) if( timings ) ( { predicted_per_second } = timings )
    return predicted_per_second

}

/**
 * Time the probe on a fresh runtime, then dispose it.
 * @param {import('wllama64').Wllama} wllama - Not yet loaded
 * @returns {Promise<number>} tokens per second
 */
export const measure_probe_tps = async wllama => {

    try {
        const skeleton = await fetch_probe_skeleton()
        await wllama.loadModel( [ skeleton ], probe_load_options( probe_threads() ) )

        // First tokens pay for thread spin-up and page faults
        await time_decode( wllama, WARMUP_TOKENS )
        return await time_decode( wllama, PROBE_TOKENS )
    } finally {
        await wllama.exit().catch( () => {} )
        await discard_probe_file()
    }

}
