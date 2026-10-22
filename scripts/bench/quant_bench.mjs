/**
 * Per-quant CPU speed benchmark: real Chrome, real wllama64 (Memory64), real GGUFs.
 * Measures prompt processing (pp) and decode (tg) tokens/sec, median of N runs,
 * to compare GGUF quant types (Q4_0 / K-quants / IQ* ...) on the WASM kernels.
 *
 * Usage: xvfb-run -a node scripts/bench/quant_bench.mjs <gguf_dir> [out.md]
 * Env:   BENCH_ONLY   substring filter on file names (e.g. "Qwen3.5-4B")
 *        BENCH_THREADS (default: half the cores, like the app)
 *        BENCH_RUNS (3), BENCH_PROMPT_REPS (50 ~ 500 tokens), BENCH_MAX_TOKENS (128)
 *        BENCH_NATIVE_LOG=1 prints llama.cpp's own log (load failures)
 * Files must be named <model>-<QUANT>.gguf; sizes for bpw come from BF16_BYTES.
 * Needs puppeteer (global install is fine) and `npm run copy_wasm` output in public/wasm.
 */
import { spawn, execSync } from 'node:child_process'
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire( import.meta.url )
const puppeteer = require( process.env.PUPPETEER_PATH || `/usr/local/lib/node_modules/puppeteer` )

const here = dirname( fileURLToPath( import.meta.url ) )
const [ , , models_dir, out_path ] = process.argv
const port = 4310
const threads = Number( process.env.BENCH_THREADS || Math.max( 1, Math.floor( cpus().length / 2 ) ) )
const runs = Number( process.env.BENCH_RUNS || 3 )

// BF16 GGUF size / 2 = parameter count, so bpw = file bits / params
const BF16_BYTES = { 'Qwen3.5-0.8B': 1516744736, 'Qwen3-0.6B': 1198182848, 'Qwen3.5-4B': 8424393632 }
const quant_order = [ `Q4_0`, `Q4_1`, `IQ4_NL`, `IQ4_XS`, `Q4_K_M`, `Q5_K_M`, `Q6_K`, `Q8_0` ]

const median = values => [ ...values ].sort( ( a, b ) => a - b )[ Math.floor( values.length / 2 ) ]

const files = readdirSync( models_dir )
    .filter( file => file.endsWith( `.gguf` ) && file.includes( process.env.BENCH_ONLY || `` ) )
    .map( file => {
        const [ , model, quant ] = file.match( /^(.+?)-([A-Za-z0-9_]+)\.gguf$/ )
        return { file, model, quant, bytes: statSync( resolve( models_dir, file ) ).size }
    } )
    .sort( ( a, b ) => a.model.localeCompare( b.model ) || quant_order.indexOf( a.quant ) - quant_order.indexOf( b.quant ) )

const server = spawn( process.execPath, [
    resolve( here, `server.mjs` ), `${ port }`,
    `/wllama/=${ resolve( here, `../../node_modules/wllama64/esm` ) }/`,
    `/wasm/=${ resolve( here, `../../public/wasm` ) }/`,
    `/models/=${ resolve( models_dir ) }/`,
    `/=${ here }/`,
], { stdio: `inherit` } )
await new Promise( done => setTimeout( done, 500 ) )

const cpu_model = execSync( `grep -m1 "model name" /proc/cpuinfo` ).toString().split( `: ` )[ 1 ].trim()

// Rewritten after every cell so a timeout or crash keeps the finished rows
const write_table = () => {
    const table = [
        `${ cpu_model }, ${ cpus().length } cores, ${ threads } thread(s), ${ chrome_version }, n_ctx 2048, FA + q8_0 KV, median of ${ runs }`,
        ``,
        `| model | quant | bytes | bpw | pp t/s | tg t/s | tg x GB |`,
        `| --- | --- | --- | --- | --- | --- | --- |`,
        ...rows.map( r => `| ${ r.model } | ${ r.quant } | ${ r.bytes } | ${ r.bpw.toFixed( 2 ) } | ${ r.pp.toFixed( 1 ) } | ${ r.tg.toFixed( 1 ) } | ${ r.gb_tg.toFixed( 1 ) } |` ),
    ].join( `\n` )
    if( out_path ) writeFileSync( out_path, `${ table }\n` )
    return table
}

const browser = await puppeteer.launch( { headless: false, channel: `chrome`, protocolTimeout: 900_000, args: [ `--unlimited-storage` ] } )
const chrome_version = await browser.version()
const rows = []

try {
    for( const entry of files ) {

        // Fresh page per cell so no cell warms caches for the next
        // Background tabs get throttled: keep the cell in the visible tab
        const page = await browser.newPage()
        await page.bringToFront()
        const query = new URLSearchParams( {
            model: entry.file, threads, runs,
            prompt_reps: process.env.BENCH_PROMPT_REPS || 50,
            max_tokens: process.env.BENCH_MAX_TOKENS || 128,
            native_log: process.env.BENCH_NATIVE_LOG || 0,
        } )
        page.on( `console`, message => ( process.env.BENCH_NATIVE_LOG || [ `warn`, `error` ].includes( message.type() ) ) && console.log( `  [page] ${ message.text() }` ) )
        await page.goto( `http://localhost:${ port }/quant_bench.html?${ query }` )
        await page.waitForFunction( () => window.__result, { timeout: 900_000 } )
        const result = await page.evaluate( () => window.__result )
        await page.close()

        if( result.error ) { console.error( `[quant_bench] ${ entry.file } failed: ${ result.error }` ); continue }

        const pp = median( result.pp )
        const tg = median( result.tg )
        const bpw = entry.bytes * 8 / ( BF16_BYTES[ entry.model ] / 2 )
        rows.push( { ...entry, bpw, pp, tg, gb_tg: tg * entry.bytes / 1e9, prompt_n: result.prompt_n, predicted_n: result.predicted_n } )
        console.log( `[quant_bench] ${ entry.file }: pp ${ pp.toFixed( 1 ) } tg ${ tg.toFixed( 1 ) } (${ result.prompt_n } prompt / ${ result.predicted_n } gen tokens)` )
        write_table()

    }
} finally {
    await browser.close()
    server.kill()
}

console.log( `\n${ write_table() }` )
