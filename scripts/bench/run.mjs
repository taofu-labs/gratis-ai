/**
 * Browser inference benchmark: real Chromium, real wllama64, real GGUF.
 * Runs every config round-robin (fairer on noisy machines) and prints a
 * markdown table of median prefill/decode tokens per second.
 *
 * Usage: node scripts/bench/run.mjs <models_dir> [rounds]
 * Env:   BENCH_WLLAMA_DIR (default node_modules/wllama64/esm)
 *        BENCH_WASM_DIR   (default public/wasm)
 *        BENCH_CONFIGS    (JSON { label: load_options }, overrides defaults)
 *        BENCH_MAX_TOKENS, BENCH_PROMPT_REPS
 * Needs a display for headful Chromium: wrap in `xvfb-run -a` on Linux.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname( fileURLToPath( import.meta.url ) )
const [ , , models_dir, rounds = `3` ] = process.argv
const port = 4300

const hardware_threads = Number( process.env.BENCH_THREADS || 4 )
const default_configs = {
    'app default': { n_threads: Math.max( 1, Math.floor( hardware_threads / 2 ) ), n_batch: 512, cache_type_k: `f16`, cache_type_v: `f16` },
    'all threads': { n_threads: hardware_threads, n_batch: 512, cache_type_k: `f16`, cache_type_v: `f16` },
    'flash attn': { n_threads: Math.max( 1, Math.floor( hardware_threads / 2 ) ), n_batch: 512, flash_attn: true },
    'flash attn + q8 kv': { n_threads: Math.max( 1, Math.floor( hardware_threads / 2 ) ), n_batch: 512, flash_attn: true, cache_type_k: `q8_0`, cache_type_v: `q8_0` },
}
const configs = process.env.BENCH_CONFIGS ? JSON.parse( process.env.BENCH_CONFIGS ) : default_configs

const models = readdirSync( models_dir ).filter( file => file.endsWith( `.gguf` ) )
const query_tail = `runs=1&max_tokens=${ process.env.BENCH_MAX_TOKENS || 96 }&prompt_reps=${ process.env.BENCH_PROMPT_REPS || 30 }`

const server = spawn( process.execPath, [
    resolve( here, `server.mjs` ),
    `${ port }`,
    `/wllama/=${ resolve( process.env.BENCH_WLLAMA_DIR || `node_modules/wllama64/esm` ) }/`,
    `/wasm/=${ resolve( process.env.BENCH_WASM_DIR || `public/wasm` ) }/`,
    `/models/=${ resolve( models_dir ) }/`,
    `/=${ here }/`,
], { stdio: `inherit` } )
await new Promise( done => setTimeout( done, 500 ) )

// Fresh browser per cell so one config cannot warm caches for the next
const run_cell = async ( model, load_options ) => {

    const browser = await chromium.launch( { headless: false, args: [ `--unlimited-storage` ] } )

    try {
        const page = await browser.newPage()
        const console_tail = []
        page.on( `console`, message => console_tail.push( message.text() ) && console_tail.length > 15 && console_tail.shift() )
        const cfg = encodeURIComponent( JSON.stringify( load_options ) )
        await page.goto( `http://localhost:${ port }/?model=${ model }&cfg=${ cfg }&${ query_tail }` )
        await page.waitForFunction( () => window.__result, null, { timeout: 900_000 } )
        const result = await page.evaluate( () => window.__result )

        // Native llama.cpp logs explain load failures the JS error hides
        if( result.error ) result.error += `\n    ${ console_tail.join( `\n    ` ) }`
        return result
    } finally {
        await browser.close()
    }

}

const median = values => {
    const sorted = values.filter( Number.isFinite ).sort( ( a, b ) => a - b )
    return sorted.length ? sorted[ Math.floor( sorted.length / 2 ) ] : NaN
}

const samples = {}
let diagnostics = null

for( let round = 0; round < Number( rounds ); round++ ) {
    for( const model of models ) {
        for( const [ label, load_options ] of Object.entries( configs ) ) {

            const result = await run_cell( model, load_options )
            const key = `${ model }|${ label }`
            samples[ key ] ||= { pp: [], tg: [], load: [] }

            if( result.error ) {
                console.error( `[bench] ${ key } failed: ${ result.error }` )
                continue
            }

            diagnostics ||= result.diagnostics
            const [ { timings } ] = result.runs
            samples[ key ].pp.push( timings?.prompt_per_second )
            samples[ key ].tg.push( timings?.predicted_per_second )
            samples[ key ].load.push( result.load_ms / 1000 )
            console.log( `[bench] round ${ round + 1 } ${ key }: pp ${ timings?.prompt_per_second?.toFixed( 1 ) } tg ${ timings?.predicted_per_second?.toFixed( 1 ) }` )

        }
    }
}

server.kill()

const rows = Object.entries( samples ).map( ( [ key, { pp, tg, load } ] ) => {
    const [ model, label ] = key.split( `|` )
    return `| ${ model } | ${ label } | ${ median( pp ).toFixed( 1 ) } | ${ median( tg ).toFixed( 1 ) } | ${ median( load ).toFixed( 1 ) } | ${ tg.length } |`
} )

const table = [
    `Diagnostics: \`${ JSON.stringify( diagnostics ) }\``,
    ``,
    `| model | config | prefill t/s | decode t/s | load s | n |`,
    `| --- | --- | --- | --- | --- | --- |`,
    ...rows,
].join( `\n` )

console.log( `\n${ table }` )
if( process.env.GITHUB_STEP_SUMMARY ) appendFileSync( process.env.GITHUB_STEP_SUMMARY, `${ table }\n` )
