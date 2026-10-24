import { afterEach, describe, expect, test, vi } from 'vitest'
import { create_mobile_bridge, tuning_args } from '../../src/native/mobile_bridge.js'

// Snapdragon 695: six Cortex-A55 @ 1.8 GHz, two Cortex-A78 @ 2.2 GHz
const SD695_CORES = [ 1804800, 1804800, 1804800, 1804800, 1804800, 1804800, 2208000, 2208000 ].map( ( max_khz, id ) => ( { id, max_khz } ) )

/**
 * Fake GratisNative plugin: an in-memory models dir and a server that is
 * "running" between startServer and stopServer
 */
const fake_native = ( { free_memory = 4e9 } = {} ) => {

    const files = new Map()
    const listeners = new Map()
    const native = {
        files,
        started: [],
        running: false,
        emit: ( name, data ) => listeners.get( name )?.forEach( callback => callback( data ) ),
        addListener: vi.fn( async ( name, callback ) => {
            if( !listeners.has( name ) ) listeners.set( name, new Set() )
            listeners.get( name ).add( callback )
            return { remove: () => listeners.get( name ).delete( callback ) }
        } ),
        getSystemInfo: vi.fn( async () => ( { total_memory: 8e9, free_memory, cpus: 8, cores: SD695_CORES, models_dir: `/models` } ) ),
        readText: vi.fn( async ( { path } ) => ( { text: files.get( path ) ?? null } ) ),
        writeText: vi.fn( async ( { path, text } ) => files.set( path, text ) ),
        deleteFile: vi.fn( async ( { path } ) => files.delete( path ) ),
        modelFiles: vi.fn( async ( { paths } ) => Object.fromEntries( paths.map( path => [ path, { exists: files.has( path ), size: 1 } ] ) ) ),
        download: vi.fn( async ( { path, expected_size } ) => {
            native.emit( `downloadProgress`, { path, bytes: expected_size / 2, total: expected_size } )
            files.set( path, `GGUF` )
            return { size: expected_size, sha256: `ab`.repeat( 32 ) }
        } ),
        abortDownload: vi.fn( async () => {} ),
        freePort: vi.fn( async () => ( { port: 41234 } ) ),
        startServer: vi.fn( async ( { args } ) => {
            native.started.push( args )
            native.running = true
        } ),
        stopServer: vi.fn( async () => native.running = false ),
        serverStatus: vi.fn( async () => ( { running: native.running, log_tail: `` } ) ),
    }
    return native

}

/** Server-sent events body for a reply split into `chunks` */
const sse = chunks => new Response( new ReadableStream( {
    start( controller ) {
        const encoder = new TextEncoder()
        for( const text of chunks ) controller.enqueue( encoder.encode( `data: ${ JSON.stringify( { choices: [ { delta: { content: text } } ] } ) }\n\n` ) )
        controller.enqueue( encoder.encode( `data: ${ JSON.stringify( { choices: [ { delta: {} } ], timings: { predicted_per_second: 12 } } ) }\n\ndata: [DONE]\n\n` ) )
        controller.close()
    },
} ) )

/** fetch stub for the loopback server */
const fake_server = ( { vision = false, reply = [ `Hello`, ` there` ] } = {} ) => vi.fn( async ( url, init = {} ) => {
    if( url.endsWith( `/health` ) ) return new Response( `{}` )
    if( url.endsWith( `/props` ) ) return Response.json( { default_generation_settings: { n_ctx: 4096 }, modalities: { vision } } )
    if( url.endsWith( `/v1/chat/completions` ) ) {
        fake_server.last_body = JSON.parse( init.body )
        return sse( reply )
    }
    return new Response( `not found`, { status: 404 } )
} )

const MODEL = { url: `https://huggingface.co/org/repo/resolve/main/m.gguf`, id: `m`, file_name: `m.gguf`, expected_size: 1000, metadata: { name: `M`, layers: 24, kv_heads: 2, head_dim: 64, context_length: 32768, file_size_bytes: 1000 } }

afterEach( () => vi.unstubAllGlobals() )

describe( `mobile bridge`, () => {

    test( `pins threads to the big cores`, () => {

        expect( tuning_args( { cores: SD695_CORES } ) ).toEqual( [ `--threads`, `2`, `--threads-batch`, `2`, `--cpu-mask`, `0xc0`, `--cpu-strict`, `1` ] )

        // Snapdragon 8 Elite: no little cores, all eight count (capped at six threads)
        const elite = [ 3532800, 3532800, 3532800, 3532800, 3532800, 3532800, 4320000, 4320000 ].map( ( max_khz, id ) => ( { id, max_khz } ) )
        expect( tuning_args( { cores: elite } ).slice( 0, 2 ) ).toEqual( [ `--threads`, `6` ] )

        // Unknown clocks: leave it to llama.cpp
        expect( tuning_args( {} ) ).toEqual( [] )

        // iOS: performance-core count, no affinity
        expect( tuning_args( { performance_cores: 2 } ) ).toEqual( [ `--threads`, `2`, `--threads-batch`, `2` ] )

    } )

    test( `iPhones with Metal keep the GPU; everything else runs on CPU`, async () => {

        vi.stubGlobal( `fetch`, fake_server() )

        for( const metal of [ true, false ] ) {
            const native = fake_native()
            native.getSystemInfo.mockResolvedValue( { total_memory: 6e9, free_memory: 3e9, performance_cores: 2, metal, models_dir: `/models` } )
            const bridge = create_mobile_bridge( native, `ios` )
            await bridge.download_model( MODEL )
            await bridge.load_model( `m` )

            expect( native.started[ 0 ].includes( `--device` ) ).toBe( !metal )
            expect( ( await bridge.get_system_info() ).gpu.metal ).toBe( metal )
        }

    } )

    test( `downloads model + projector, then records one manifest entry`, async () => {

        const native = fake_native()
        const bridge = create_mobile_bridge( native, `android` )
        const progress = []
        bridge.on_download_progress( event => progress.push( event ) )

        await bridge.download_model( { ...MODEL, mmproj: { url: `https://huggingface.co/org/repo/resolve/main/mmproj-F16.gguf`, file_name: `mmproj-F16.gguf`, expected_size: 500 } } )

        // Projector stored next to the model under a model-specific name
        expect( native.download.mock.calls.map( ( [ { path } ] ) => path ) ).toEqual( [ `m.gguf`, `m.mmproj-F16.gguf` ] )

        const manifest = JSON.parse( native.files.get( `manifest.json` ) )
        expect( manifest ).toHaveLength( 1 )
        expect( manifest[ 0 ] ).toMatchObject( { id: `m`, file_name: `m.gguf`, file_size_bytes: 1000, mmproj_file_name: `mmproj-F16.gguf`, mmproj_size_bytes: 500 } )

        // Progress is summed over both files
        expect( progress.at( -1 ) ).toMatchObject( { progress: 1, bytes_loaded: 1500, bytes_total: 1500, status: `Complete` } )

        // A second download of the same id replaces, never duplicates
        await bridge.download_model( MODEL )
        expect( JSON.parse( native.files.get( `manifest.json` ) ) ).toHaveLength( 1 )

    } )

    test( `a failed download installs nothing`, async () => {

        const native = fake_native()
        native.download.mockRejectedValueOnce( new Error( `Download aborted` ) )
        const bridge = create_mobile_bridge( native, `android` )

        await expect( bridge.download_model( MODEL ) ).rejects.toThrow( /aborted/ )
        expect( native.files.has( `manifest.json` ) ).toBe( false )

    } )

    test( `loads on CPU with device tuning, a phone-sized context and the projector when present`, async () => {

        const native = fake_native( { free_memory: 3e9 } )
        vi.stubGlobal( `fetch`, fake_server( { vision: true } ) )
        const bridge = create_mobile_bridge( native, `android` )
        await bridge.download_model( { ...MODEL, mmproj: { url: `x`, file_name: `mmproj-F16.gguf`, expected_size: 500 } } )

        const result = await bridge.load_model( `m` )

        expect( result ).toMatchObject( { success: true, context_size: 4096, has_image_input: true, has_projector: true } )
        const args = native.started[ 0 ]
        const arg = name => args[ args.indexOf( name ) + 1 ]
        expect( arg( `--model` ) ).toBe( `/models/m.gguf` )
        expect( arg( `--mmproj` ) ).toBe( `/models/m.mmproj-F16.gguf` )
        expect( arg( `--port` ) ).toBe( `41234` )
        expect( arg( `--device` ) ).toBe( `none` )
        expect( arg( `--threads` ) ).toBe( `2` )
        expect( Number( arg( `--ctx-size` ) ) ).toBeLessThanOrEqual( 8192 )
        expect( arg( `--api-key` ) ).toMatch( /^[0-9a-f]{48}$/ )

    } )

    test( `streams text, then timings, then done`, async () => {

        const native = fake_native()
        vi.stubGlobal( `fetch`, fake_server() )
        const bridge = create_mobile_bridge( native, `android` )
        await bridge.download_model( MODEL )
        await bridge.load_model( `m` )

        const chunks = []
        let done = 0
        bridge.on_stream_token( chunk => chunks.push( chunk ) )
        bridge.on_stream_done( () => done++ )

        const text = await bridge.start_stream( [ { role: `user`, content: `hi` } ], { max_tokens: 64 } )

        expect( text ).toBe( `Hello there` )
        expect( chunks ).toEqual( [ `Hello`, ` there`, { timings: { predicted_per_second: 12 } } ] )
        expect( done ).toBe( 1 )
        expect( fake_server.last_body ).toMatchObject( { stream: true, max_tokens: 64, messages: [ { role: `user`, content: `hi` } ] } )

    } )

    test( `a server killed by the OS restarts on the next request`, async () => {

        const native = fake_native()
        vi.stubGlobal( `fetch`, fake_server() )
        const bridge = create_mobile_bridge( native, `android` )
        await bridge.download_model( MODEL )
        await bridge.load_model( `m` )

        native.running = false
        native.emit( `serverExit`, { code: 137, log_tail: `killed` } )

        expect( await bridge.chat( [ { role: `user`, content: `hi` } ] ) ).toBe( `Hello there` )
        expect( native.started ).toHaveLength( 2 )

    } )

    test( `deleting the loaded model unloads it and removes its files`, async () => {

        const native = fake_native()
        vi.stubGlobal( `fetch`, fake_server() )
        const bridge = create_mobile_bridge( native, `android` )
        await bridge.download_model( MODEL )
        await bridge.load_model( `m` )

        await bridge.delete_model( `m` )

        expect( native.stopServer ).toHaveBeenCalled()
        expect( native.files.has( `m.gguf` ) ).toBe( false )
        expect( await bridge.list_models() ).toEqual( [] )
        expect( bridge.get_loaded_model() ).toMatchObject( { loaded: false } )

    } )

    test( `unloading mid-load cancels the load and leaves nothing running`, async () => {

        const native = fake_native()
        let healthy = false
        const server = fake_server()
        vi.stubGlobal( `fetch`, vi.fn( ( url, init ) => url.endsWith( `/health` ) && !healthy ? Promise.reject( new TypeError( `refused` ) ) : server( url, init ) ) )
        const bridge = create_mobile_bridge( native, `android` )
        await bridge.download_model( MODEL )

        const loading = bridge.load_model( `m` )
        await vi.waitFor( () => expect( native.started ).toHaveLength( 1 ) )
        await bridge.unload_model()
        healthy = true

        await expect( loading ).rejects.toThrow( /cancelled/ )
        expect( native.running ).toBe( false )
        expect( bridge.get_loaded_model().loaded ).toBe( false )

    } )

    test( `a superseded load cannot clear the newer model`, async () => {

        const native = fake_native()
        vi.stubGlobal( `fetch`, fake_server() )
        const bridge = create_mobile_bridge( native, `android` )
        await bridge.download_model( MODEL )
        await bridge.download_model( { ...MODEL, id: `n`, file_name: `n.gguf` } )

        const first = bridge.load_model( `m` )
        const second = bridge.load_model( `n` )

        await expect( first ).rejects.toThrow( /cancelled/ )
        await expect( second ).resolves.toMatchObject( { success: true } )
        expect( bridge.get_loaded_model() ).toMatchObject( { loaded: true, model_id: `n` } )

    } )

    test( `a server that never gets healthy fails the load`, async () => {

        const native = fake_native()
        vi.stubGlobal( `fetch`, vi.fn( async () => new Response( `{}`, { status: 503 } ) ) )
        const bridge = create_mobile_bridge( native, `android` )
        await bridge.download_model( MODEL )

        vi.useFakeTimers( { toFake: [ `Date` ] } )
        const loading = bridge.load_model( `m` )
        await vi.waitFor( () => expect( native.started ).toHaveLength( 1 ) )
        vi.setSystemTime( Date.now() + 10 * 60_000 )

        await expect( loading ).rejects.toThrow( /too long/ )
        expect( native.running ).toBe( false )
        vi.useRealTimers()

    } )

    test( `a server that dies while loading reports why`, async () => {

        const native = fake_native()
        native.startServer.mockImplementation( async () => native.running = false )
        native.serverStatus.mockResolvedValue( { running: false, log_tail: `llama_model_load: error loading model\nfailed to load model` } )
        vi.stubGlobal( `fetch`, fake_server() )
        const bridge = create_mobile_bridge( native, `android` )
        await bridge.download_model( MODEL )

        await expect( bridge.load_model( `m` ) ).rejects.toThrow( /could not start.*failed to load model/ )
        expect( bridge.get_loaded_model().loaded ).toBe( false )

    } )

} )
