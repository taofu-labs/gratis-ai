/**
 * Reference decode-speed table for the catalog (`browser_tps`) plus the device
 * probe's speed on the same machine (REFERENCE_PROBE_TPS in src/utils/speed_probe.js).
 * The app scales the table by probe-on-device ÷ probe-here, so both must come
 * from one machine and one run. Every model cell sits between two probe cells:
 * its speed relative to their mean cancels whatever load the machine had at
 * the time. Table = median relative speed × median probe speed.
 *
 * Usage: xvfb-run -a node scripts/bench/speed_table.mjs <models_dir> [rounds]
 * <models_dir> holds <catalog id>.gguf files (the TPN builds). Needs network for the probe header.
 * Env:   BENCH_ONLY  substring filter on catalog ids
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname( fileURLToPath( import.meta.url ) )
const [ , , models_dir, rounds = `2` ] = process.argv
const port = 4330

const models = readdirSync( models_dir )
    .filter( file => file.endsWith( `.gguf` ) && file.includes( process.env.BENCH_ONLY || `` ) )
    .sort()

const server = spawn( process.execPath, [
    resolve( here, `server.mjs` ), `${ port }`,
    `/wllama/=${ resolve( here, `../../node_modules/wllama64/esm` ) }/`,
    `/wasm/=${ resolve( here, `../../public/wasm` ) }/`,
    `/utils/=${ resolve( here, `../../src/utils` ) }/`,
    `/models/=${ resolve( models_dir ) }/`,
    `/=${ here }/`,
], { stdio: `inherit` } )
await new Promise( done => setTimeout( done, 500 ) )

// A persistent profile: incognito contexts cap OPFS far below a 6 GB model
const profile_dir = mkdtempSync( resolve( tmpdir(), `speed-table-` ) )
const browser = await chromium.launchPersistentContext( profile_dir, { headless: false, args: [ `--unlimited-storage` ] } )
const probes = []
const relative = {}
const median = values => [ ...values ].sort( ( a, b ) => a - b )[ Math.floor( values.length / 2 ) ]

// Fresh, visible page per cell: background tabs are throttled
const cell = async query => {
    const page = await browser.newPage()
    await page.goto( `http://localhost:${ port }/speed_table.html?${ new URLSearchParams( query ) }` )
    await page.waitForFunction( () => window.__result, null, { timeout: 1_800_000, polling: 1000 } )
    const result = await page.evaluate( () => window.__result )
    await page.close()
    return result
}

const measure = async ( label, query ) => {
    const { tps, error } = await cell( query )
    if( error ) console.error( `[speed_table] ${ label } failed: ${ error.split( `\n` )[ 0 ] }` )
    else console.log( `[speed_table] ${ label }: ${ tps.toFixed( 3 ) } t/s` )
    return error ? null : tps
}

try {
    let before = await measure( `probe`, { probe: 1 } )
    probes.push( before )
    for( let round = 0; round < Number( rounds ); round++ ) {
        for( const file of models ) {
            const id = file.replace( /\.gguf$/, `` )
            const tps = await measure( id, { model: file } )
            const after = await measure( `probe`, { probe: 1 } )
            probes.push( after )
            if( tps && before && after ) ( relative[ id ] ||= [] ).push( tps / ( ( before + after ) / 2 ) )
            before = after
        }
    }
} finally {
    await browser.close()
    rmSync( profile_dir, { recursive: true, force: true } )
    server.kill()
}

const probe_tps = median( probes.filter( Boolean ) )
console.log( `\n${ cpus()[ 0 ].model }, ${ cpus().length } cores, ${ rounds } round(s)\nREFERENCE_PROBE_TPS = ${ probe_tps.toFixed( 2 ) }\n` )
for( const [ id, ratios ] of Object.entries( relative ) ) {
    console.log( `${ id }: browser_tps ${ ( median( ratios ) * probe_tps ).toFixed( 2 ) }  (relative ${ ratios.map( r => r.toFixed( 3 ) ).join( ` ` ) })` )
}
