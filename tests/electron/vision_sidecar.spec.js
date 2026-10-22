import { test, expect } from '@playwright/test'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { launch_electron, get_models_dir } from '../helpers/electron_helpers'

// Vision sidecar: models with an mmproj run in the bundled llama-server,
// text-only models stay on node-llama-cpp. Drives window.electronAPI directly
// (the attach UI is covered elsewhere).
//
// Needs `npm run fetch:llama-server` plus these files in the cache dir:
//   Qwen3.5-0.8B-Q4_K_M.gguf, Qwen3.5-0.8B-mmproj-F16.gguf  (unsloth/Qwen3.5-0.8B-GGUF)
//   Qwen3-0.6B-Q4_K_M.gguf                                  (unsloth/Qwen3-0.6B-GGUF)

const CACHE_DIR = process.env.GRATIS_TEST_MODELS || `/tmp/gratisai-test-models`

const VISION = {
    id: `test-vision-qwen35-08b`,
    name: `Qwen3.5 0.8B (vision test)`,
    file_name: `Qwen3.5-0.8B-Q4_K_M.gguf`,
    mmproj_cache_name: `Qwen3.5-0.8B-mmproj-F16.gguf`,
    mmproj_file_name: `mmproj-F16.gguf`,
    context_length: 8192,
    reasoning_enabled: false,
}

const TEXT = {
    id: `test-text-qwen3-06b`,
    name: `Qwen3 0.6B (text test)`,
    file_name: `Qwen3-0.6B-Q4_K_M.gguf`,
    context_length: 4096,
}

const required = [ VISION.file_name, VISION.mmproj_cache_name, TEXT.file_name ]
const missing = required.filter( ( name ) => !fs.existsSync( path.join( CACHE_DIR, name ) ) )

/** Count running llama-server processes started from this checkout */
const sidecar_count = () => {
    try {
        return execSync( `pgrep -f "llama-server.*[ ]--api-key"`, { encoding: `utf-8` } ).trim().split( `\n` ).filter( Boolean ).length
    } catch {
        return 0
    }
}

/**
 * Minimal PNG of a red square on white — no image library needed.
 * The model is asked what colour the square is.
 * @returns {Buffer}
 */
const make_png = () => {

    const width = 256
    const height = 256
    const rows = []
    for( let y = 0; y < height; y++ ) {
        const row = Buffer.alloc( 1 + width * 3, 255 )
        row[ 0 ] = 0
        for( let x = 64; x < 192; x++ ) if( y >= 64 && y < 192 ) {
            // Pure red square in the middle
            row[ 1 + x * 3 ] = 255
            row[ 2 + x * 3 ] = 0
            row[ 3 + x * 3 ] = 0
        }
        rows.push( row )
    }

    const crc_table = Array.from( { length: 256 }, ( _, n ) => {
        let c = n
        for( let k = 0; k < 8; k++ ) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1
        return c >>> 0
    } )
    const crc32 = ( buffer ) => {
        let c = 0xffffffff
        for( const byte of buffer ) c = crc_table[ ( c ^ byte ) & 0xff ] ^ c >>> 8
        return ( c ^ 0xffffffff ) >>> 0
    }
    const chunk = ( type, data ) => {
        const body = Buffer.concat( [ Buffer.from( type ), data ] )
        const length = Buffer.alloc( 4 )
        length.writeUInt32BE( data.length )
        const crc = Buffer.alloc( 4 )
        crc.writeUInt32BE( crc32( body ) )
        return Buffer.concat( [ length, body, crc ] )
    }

    const header = Buffer.alloc( 13 )
    header.writeUInt32BE( width, 0 )
    header.writeUInt32BE( height, 4 )
    header[ 8 ] = 8
    header[ 9 ] = 2

    return Buffer.concat( [
        Buffer.from( [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ] ),
        chunk( `IHDR`, header ),
        chunk( `IDAT`, zlib.deflateSync( Buffer.concat( rows ) ) ),
        chunk( `IEND`, Buffer.alloc( 0 ) ),
    ] )

}

/**
 * Stream a chat through window.electronAPI and collect text + metadata chunks
 * @param {import('@playwright/test').Page} page
 * @param {Array} messages - `attachments[].data` given as a number array (converted to ArrayBuffer in page)
 * @param {Object} [opts] - Generation options
 * @returns {Promise<{ text: string, meta: Array }>}
 */
const stream_chat = ( page, messages, opts = { max_tokens: 48, temperature: 0 } ) => page.evaluate( async ( [ messages, opts ] ) => {

    const api = window.electronAPI
    const ipc_messages = messages.map( ( message ) => ( {
        ...message,
        ... message.attachments ? { attachments: message.attachments.map( ( a ) => ( { ...a, data: new Uint8Array( a.data ).buffer } ) ) } : {},
    } ) )

    let text = ``
    const meta = []
    const remove_token = api.on_stream_token( ( chunk ) => typeof chunk === `string` ? text += chunk : meta.push( chunk ) )
    const done = new Promise( ( resolve ) => {
        const remove_done = api.on_stream_done( () => {
            remove_done()
            resolve()
        } )
    } )

    await api.start_stream( ipc_messages, opts )
    await done
    remove_token()
    return { text, meta }

}, [ messages, opts ] )

let app
let page

test.describe( `Electron vision sidecar`, () => {

    test.skip( missing.length > 0, `Missing test models in ${ CACHE_DIR }: ${ missing.join( `, ` ) }` )
    test.setTimeout( 600_000 )

    test.beforeAll( async () => {

        ( { app, page } = await launch_electron() )

        // Install both models straight into the app's models dir
        const models_dir = await get_models_dir( app )
        fs.mkdirSync( models_dir, { recursive: true } )
        for( const name of [ VISION.file_name, TEXT.file_name ] ) fs.copyFileSync( path.join( CACHE_DIR, name ), path.join( models_dir, name ) )
        fs.copyFileSync(
            path.join( CACHE_DIR, VISION.mmproj_cache_name ),
            path.join( models_dir, `${ VISION.file_name.replace( /\.gguf$/, `` ) }.${ VISION.mmproj_file_name }` ),
        )

        const manifest_path = path.join( models_dir, `models_manifest.json` )
        const manifest = fs.existsSync( manifest_path ) ? JSON.parse( fs.readFileSync( manifest_path, `utf-8` ) ) : []
        const others = manifest.filter( ( m ) => ![ VISION.id, TEXT.id ].includes( m.id ) )
        const now = Date.now()
        const vision_entry = Object.fromEntries( Object.entries( VISION ).filter( ( [ key ] ) => key !== `mmproj_cache_name` ) )
        fs.writeFileSync( manifest_path, JSON.stringify( [
            ...others,
            { ...vision_entry, file_size_bytes: fs.statSync( path.join( CACHE_DIR, VISION.file_name ) ).size, cached_at: now, last_used_at: now },
            { ...TEXT, file_size_bytes: fs.statSync( path.join( CACHE_DIR, TEXT.file_name ) ).size, cached_at: now, last_used_at: now },
        ], null, 2 ) )

    } )

    test.afterAll( async () => {
        if( !app ) return
        await page.evaluate( ( ids ) => Promise.all( ids.map( ( id ) => window.electronAPI.delete_model( id ).catch( () => {} ) ) ), [ VISION.id, TEXT.id ] )
        await app.close()
    } )

    test( `vision model runs in llama-server and reads an image`, async () => {

        const result = await page.evaluate( ( id ) => window.electronAPI.load_model( id ), VISION.id )
        expect( result.has_image_input ).toBe( true )
        expect( result.context_size ).toBeGreaterThan( 0 )
        expect( sidecar_count() ).toBe( 1 )

        const png = [ ...make_png() ]
        const { text, meta } = await stream_chat( page, [
            { role: `system`, content: `You are a helpful assistant.` },
            { role: `user`, content: `What colour is the square in this image? Answer with one word.`, attachments: [ { kind: `image`, mime: `image/png`, name: `square.png`, data: png } ] },
        ] )

        console.log( `vision answer:`, JSON.stringify( text ) )
        expect( text.toLowerCase() ).toContain( `red` )
        expect( meta.some( ( chunk ) => chunk.timings ) ).toBe( true )

        // Follow-up keeps the full history (image included) — node-llama-cpp only sees the last turn
        const follow_up = await stream_chat( page, [
            { role: `user`, content: `My name is Ada. What colour is this square?`, attachments: [ { kind: `image`, mime: `image/png`, name: `square.png`, data: png } ] },
            { role: `assistant`, content: text },
            { role: `user`, content: `What is my name? One word.` },
        ] )
        console.log( `follow-up answer:`, JSON.stringify( follow_up.text ) )
        expect( follow_up.text ).toMatch( /ada/i )

    } )

    test( `text model switches back to node-llama-cpp and stops the sidecar`, async () => {

        const result = await page.evaluate( ( id ) => window.electronAPI.load_model( id ), TEXT.id )
        expect( result.has_image_input ).toBe( false )
        expect( sidecar_count() ).toBe( 0 )

        // node-llama-cpp hides Qwen3 thoughts from the stream — skip thinking so text arrives fast
        const { text, meta } = await stream_chat( page, [ { role: `user`, content: `Say hello in one word. /no_think` } ], { max_tokens: 512 } )
        console.log( `text answer:`, JSON.stringify( text ) )
        expect( text.length ).toBeGreaterThan( 0 )
        expect( meta ).toEqual( [] )

    } )

    test( `abort stops a sidecar generation and app quit leaves no process behind`, async () => {

        await page.evaluate( ( id ) => window.electronAPI.load_model( id ), VISION.id )
        expect( sidecar_count() ).toBe( 1 )

        const started = Date.now()
        const pending = stream_chat( page, [ { role: `user`, content: `Count from 1 to 300, comma separated.` } ], { max_tokens: 1500 } )
        await page.waitForTimeout( 1_500 )
        await page.evaluate( () => window.electronAPI.abort() )
        await pending
        expect( Date.now() - started ).toBeLessThan( 30_000 )

        await page.evaluate( ( ids ) => Promise.all( ids.map( ( id ) => window.electronAPI.delete_model( id ) ) ), [ VISION.id, TEXT.id ] )
        await app.close()
        app = null
        await new Promise( ( resolve ) => setTimeout( resolve, 1_000 ) )
        expect( sidecar_count() ).toBe( 0 )

    } )

} )

// Real Hugging Face download (~740 MB) — opt in with GRATIS_TEST_DOWNLOAD=1
test.describe( `Electron vision download`, () => {

    test.skip( !process.env.GRATIS_TEST_DOWNLOAD, `Set GRATIS_TEST_DOWNLOAD=1 to run the real download test` )
    test.setTimeout( 900_000 )

    test( `downloads model + projector, adds image support later, deletes both`, async () => {

        const { app, page } = await launch_electron()
        const models_dir = await get_models_dir( app )
        const repo = `https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main`
        const model = {
            url: `${ repo }/Qwen3.5-0.8B-Q4_K_M.gguf`,
            id: `test-download-vision`,
            file_name: `Qwen3.5-0.8B-Q4_K_M.gguf`,
            expected_size: 532_517_120,
            metadata: { name: `Download test` },
        }
        const mmproj = { url: `${ repo }/mmproj-F16.gguf`, file_name: `mmproj-F16.gguf`, expected_size: 204_987_232 }
        const projector_path = path.join( models_dir, `Qwen3.5-0.8B-Q4_K_M.mmproj-F16.gguf` )

        // Collect progress in the page so we can check the summed total
        const download = ( payload ) => page.evaluate( async ( payload ) => {
            const events = []
            const remove = window.electronAPI.on_download_progress( ( p ) => events.push( p ) )
            const started = Date.now()
            await window.electronAPI.download_model( payload )
            remove()
            return { events, ms: Date.now() - started }
        }, payload )

        try {

            // 1. Text-only install
            await download( model )
            let entry = ( await page.evaluate( () => window.electronAPI.list_models() ) ).find( ( m ) => m.id === model.id )
            expect( entry.mmproj_file_name ).toBeUndefined()

            // 2. Add image support — the model is complete, so only the projector is fetched
            const { events } = await download( { ...model, mmproj } )
            const last = events[ events.length - 1 ]
            expect( last.status ).toBe( `Complete` )
            expect( last.bytes_total ).toBe( model.expected_size + mmproj.expected_size )
            expect( events.find( ( e ) => e.status === `Downloading...` ).bytes_loaded ).toBeGreaterThanOrEqual( model.expected_size )

            entry = ( await page.evaluate( () => window.electronAPI.list_models() ) ).find( ( m ) => m.id === model.id )
            expect( entry.mmproj_file_name ).toBe( `mmproj-F16.gguf` )
            expect( entry.mmproj_size_bytes ).toBe( mmproj.expected_size )
            expect( fs.existsSync( projector_path ) ).toBe( true )

            // 3. Delete removes both files
            await page.evaluate( ( id ) => window.electronAPI.delete_model( id ), model.id )
            expect( fs.existsSync( path.join( models_dir, model.file_name ) ) ).toBe( false )
            expect( fs.existsSync( projector_path ) ).toBe( false )

        } finally {
            await page.evaluate( ( id ) => window.electronAPI.delete_model( id ).catch( () => {} ), model.id )
            await app.close()
        }

    } )

} )
