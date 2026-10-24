/**
 * Mobile bridge — gives the Android/iOS apps (Capacitor) the same
 * `window.electronAPI` surface the desktop app has, so the provider, model
 * manager, downloads and picker run unchanged on `native_inference`.
 *
 * Inference: the native `GratisNative` plugin runs upstream llama.cpp
 * `llama-server` (Android: child process from the APK's native libs; iOS: in
 * process) on 127.0.0.1; this file talks to it over HTTP like the desktop
 * sidecar (electron/llama_server.js). Downloads, hashing and files are native.
 *
 * Absent on purpose: `updater` (app stores ship updates), `save_model`.
 */

import { log } from 'mentie'
import {
    build_request_body,
    build_server_args,
    create_sse_parser,
    estimate_context_size,
    mmproj_local_name,
} from '../utils/llama_server_protocol'

const MANIFEST = `manifest.json`
const HEALTH_POLL_MS = 250
const HEALTH_TIMEOUT_MS = 5 * 60_000

// Phones: models may take ~55% of what the OS reports free right before load,
// and long contexts make prompt processing crawl on mobile CPUs
const MOBILE_MEMORY_SHARE = 0.55
const MOBILE_MAX_CTX = 8192
const MOBILE_RUNTIME_OVERHEAD = 300_000_000

// Cores at or below this clock are efficiency cores (Cortex-A55/A510 class)
const LITTLE_CORE_MAX_KHZ = 2_050_000

const sleep = ms => new Promise( resolve => setTimeout( resolve, ms ) )

/**
 * Thread settings for this phone's CPU. Decode is memory-bound and little
 * cores drag every step down, so run one thread per big core, pinned to them.
 * iOS reports its performance-core count instead (no thread affinity there).
 * @param {{ cores?: Array<{ id: number, max_khz: number }>, performance_cores?: number }} system_info
 * @returns {string[]} Extra llama-server arguments
 */
export const tuning_args = ( { cores = [], performance_cores } = {} ) => {

    if( performance_cores ) return [ `--threads`, String( performance_cores ), `--threads-batch`, String( performance_cores ) ]

    const fastest = Math.max( 0, ...cores.map( ( { max_khz } ) => max_khz ) )
    const big = cores.filter( ( { max_khz } ) => max_khz > LITTLE_CORE_MAX_KHZ || max_khz === fastest )
    if( !big.length ) return []

    const threads = Math.min( Math.max( big.length, 2 ), 6 )
    const mask = big.reduce( ( bits, { id } ) => bits | 1n << BigInt( id ), 0n )

    return [
        `--threads`, String( threads ),
        `--threads-batch`, String( threads ),
        ... big.length >= 2 ? [ `--cpu-mask`, `0x${ mask.toString( 16 ) }`, `--cpu-strict`, `1` ] : [],
    ]

}

/** Random per-launch API key: other apps on the phone can reach loopback too */
const random_key = () => Array.from( crypto.getRandomValues( new Uint8Array( 24 ) ), byte => byte.toString( 16 ).padStart( 2, `0` ) ).join( `` )

/**
 * Tiny event hub standing in for Electron's ipcRenderer.on
 * @returns {{ on: ( callback: Function ) => Function, emit: ( value: any ) => void }}
 */
const channel = () => {
    const listeners = new Set()
    return {
        on: callback => {
            listeners.add( callback )
            return () => listeners.delete( callback )
        },
        emit: value => listeners.forEach( callback => callback( value ) ),
    }
}

/**
 * Build the bridge around the native plugin
 * @param {Object} native - Capacitor `GratisNative` plugin proxy
 * @param {string} platform - `android` | `ios`
 * @returns {Object} electronAPI-shaped object
 */
export const create_mobile_bridge = ( native, platform ) => {

    const stream_tokens = channel()
    const stream_done = channel()
    const download_progress = channel()

    // Server state: config survives a crash so the next request relaunches it
    let server = null          // { base_url, api_key }
    let config = null          // { model_id, args_base, reasoning_enabled, n_ctx }
    let launching = null
    let abort_controller = null
    let system_info = null

    native.addListener( `serverExit`, ( { code, log_tail } ) => {
        if( !server ) return
        log.warn( `[mobile] llama-server exited (code ${ code }) — will restart on next request\n${ log_tail || `` }` )
        server = null
    } )

    // ── System ───────────────────────────────────────────────────

    const get_system_info = async () => {
        system_info = await native.getSystemInfo()
        return {
            ...system_info,
            platform,
            gpu: {
                // iOS: Metal on Apple7+ GPUs (A14 and newer); Android stays on CPU
                type: system_info.metal ? `metal` : false,
                metal: !!system_info.metal,
                cuda: false,
                vulkan: false,
                vram_total: 0,
                vram_free: 0,
                unified_memory: 0,
                device_names: system_info.gpu_name ? [ system_info.gpu_name ] : [],
            },
        }
    }

    // ── Manifest (models/manifest.json, next to the files it describes) ──

    const read_manifest = async () => {
        const { text } = await native.readText( { path: MANIFEST } )
        try {
            return text ? JSON.parse( text ) : []
        } catch {
            return []
        }
    }

    const write_manifest = manifest => native.writeText( { path: MANIFEST, text: JSON.stringify( manifest, null, 2 ) } )

    const projector_name = model => model.mmproj_file_name ? mmproj_local_name( model.file_name, model.mmproj_file_name ) : null

    // ── Downloads ────────────────────────────────────────────────

    /**
     * Same contract as Electron's `llm:download_model`: model (+ projector)
     * streamed to disk natively, resumed from a partial file, size + GGUF magic
     * + SHA-256 checked, and only then recorded in the manifest.
     */
    const download_model = async ( { url, id, file_name, metadata, expected_size, headers = {}, mmproj } ) => {

        const files = [
            { url, path: file_name, expected_size },
            ... mmproj ? [ { url: mmproj.url, path: mmproj_local_name( file_name, mmproj.file_name ), expected_size: mmproj.expected_size } ] : [],
        ]

        // Summed progress over both files, throttled natively
        const totals = files.map( file => file.expected_size || 0 )
        const done = files.map( () => 0 )
        const report = status => {
            const bytes_total = totals.reduce( ( sum, size ) => sum + size, 0 )
            const bytes_loaded = done.reduce( ( sum, bytes ) => sum + bytes, 0 )
            download_progress.emit( { progress: bytes_total ? Math.min( bytes_loaded / bytes_total, 1 ) : 0, bytes_loaded, bytes_total, status } )
        }

        const sizes = []
        for( const [ index, file ] of files.entries() ) {

            const listener = await native.addListener( `downloadProgress`, ( { path, bytes, total, verifying } ) => {
                if( path !== file.path ) return
                done[ index ] = bytes
                if( total ) totals[ index ] = total
                report( verifying ? `Verifying...` : `Downloading...` )
            } )

            try {
                const { size } = await native.download( { url: file.url, path: file.path, headers, expected_size: file.expected_size || 0 } )
                done[ index ] = totals[ index ] = sizes[ index ] = size
            } finally {
                listener.remove()
            }

        }

        // Record the install only once every file is complete and verified
        const installed = await read_manifest()
        const previous = installed.find( entry => entry.id === id )
        const manifest = installed.filter( entry => entry.id !== id )
        const now = Date.now()
        manifest.push( {
            ...metadata,
            id,
            file_name,
            file_size_bytes: sizes[ 0 ],
            ... mmproj ? { mmproj_file_name: mmproj.file_name, mmproj_size_bytes: sizes[ 1 ] } : {},
            cached_at: previous?.cached_at || now,
            last_used_at: now,
        } )
        await write_manifest( manifest )
        report( `Complete` )

        return { success: true }

    }

    const abort_download = () => native.abortDownload()

    const list_models = read_manifest

    const delete_model = async model_id => {

        const manifest = await read_manifest()
        const model = manifest.find( entry => entry.id === model_id )
        if( !model ) return { success: false }

        if( config?.model_id === model_id ) await unload_model()
        await write_manifest( manifest.filter( entry => entry.id !== model_id ) )
        for( const path of [ model.file_name, projector_name( model ) ] ) if( path ) await native.deleteFile( { path } )

        return { success: true }

    }

    // ── Server lifecycle ─────────────────────────────────────────

    const request = ( pathname, init = {} ) => fetch( `${ server.base_url }${ pathname }`, {
        ...init,
        headers: { Authorization: `Bearer ${ server.api_key }`, ...init.headers },
    } )

    /** Start llama-server for `config` and wait until it answers */
    const launch = async () => {

        const { port } = await native.freePort()
        const api_key = random_key()
        const args = build_server_args( { ...config.args_base, port, api_key, cpu_only: config.cpu_only, extra: config.tuning } )

        log.info( `[mobile] Starting llama-server: ${ args.join( ` ` ) }` )
        await native.startServer( { args } )
        server = { base_url: `http://127.0.0.1:${ port }`, api_key }

        const deadline = Date.now() + HEALTH_TIMEOUT_MS
        while( Date.now() < deadline ) {
            const { running, log_tail } = await native.serverStatus()
            if( !running ) {
                server = null
                throw new Error( `The model could not start: ${ ( log_tail || `` ).split( `\n` ).slice( -3 ).join( ` | ` ) }` )
            }
            try {
                if( ( await request( `/health` ) ).ok ) break
            } catch {
                // Not listening yet
            }
            await sleep( HEALTH_POLL_MS )
        }

        const props = await request( `/props` ).then( response => response.json() )
        return {
            context_size: props?.default_generation_settings?.n_ctx || config.n_ctx,
            has_image_input: !!props?.modalities?.vision,
        }

    }

    /** Concurrent callers share one launch */
    const ensure_running = async () => {
        if( !config ) throw new Error( `No model loaded` )
        if( server ) return
        launching ||= launch().finally( () => launching = null )
        await launching
    }

    const load_model = async model_id => {

        const manifest = await read_manifest()
        const model = manifest.find( entry => entry.id === model_id )
        if( !model ) throw new Error( `Model not found: ${ model_id }` )

        // Free the previous model before measuring what this one can use
        await unload_model()

        const files = await native.modelFiles( { paths: [ model.file_name, projector_name( model ) ].filter( Boolean ) } )
        if( !files[ model.file_name ]?.exists ) throw new Error( `Model file missing: ${ model.file_name }` )
        const mmproj_path = projector_name( model )
        const has_projector = !!mmproj_path && !!files[ mmproj_path ]?.exists

        const info = await native.getSystemInfo()
        const { free_memory, models_dir } = info
        const n_ctx = estimate_context_size( has_projector ? model : { ...model, mmproj_size_bytes: 0 }, free_memory * MOBILE_MEMORY_SHARE, {
            overhead_bytes: MOBILE_RUNTIME_OVERHEAD,
            max_ctx: MOBILE_MAX_CTX,
        } )

        config = {
            model_id,
            n_ctx,
            tuning: tuning_args( info ),
            cpu_only: !info.metal,
            reasoning_enabled: model.reasoning_enabled,
            args_base: {
                model_path: `${ models_dir }/${ model.file_name }`,
                mmproj_path: has_projector ? `${ models_dir }/${ mmproj_path }` : null,
                n_ctx,
            },
        }

        try {
            launching = launch().finally( () => launching = null )
            const info = await launching
            await write_manifest( manifest.map( entry => entry.id === model_id ? { ...entry, last_used_at: Date.now() } : entry ) )
            return {
                success: true,
                context_size: info.context_size,
                context_reduced: info.context_size < ( model.context_length || n_ctx ),
                has_image_input: info.has_image_input,
                has_projector,
            }
        } catch ( error ) {
            config = null
            throw error
        }

    }

    const unload_model = async () => {
        abort()
        config = null
        server = null
        await native.stopServer()
        return { success: true }
    }

    const get_loaded_model = () => ( { loaded: !!config, model_id: config?.model_id || null, has_image_input: !!config?.args_base.mmproj_path } )

    // ── Inference ────────────────────────────────────────────────

    /**
     * Stream one chat completion; text deltas, `{ prompt_progress }` and a
     * final `{ timings }` go to `on_chunk`, exactly like the desktop sidecar
     */
    const run_chat = async ( messages, opts = {}, on_chunk = () => {}, is_retry = false ) => {

        await ensure_running()

        const controller = new AbortController()
        abort_controller = controller

        let full_text = ``
        let timings = null
        const on_data = payload => {
            if( payload.error ) throw new Error( payload.error.message || `llama-server error` )
            const text = payload.choices?.[ 0 ]?.delta?.content
            if( payload.prompt_progress && !full_text ) on_chunk( { prompt_progress: payload.prompt_progress } )
            if( payload.timings ) ( { timings } = payload )
            if( text ) {
                full_text += text
                on_chunk( text )
            }
        }

        try {

            const response = await request( `/v1/chat/completions`, {
                method: `POST`,
                headers: { 'Content-Type': `application/json` },
                body: JSON.stringify( build_request_body( messages, opts, config ) ),
                signal: controller.signal,
            } )
            if( !response.ok ) throw new Error( `llama-server ${ response.status }: ${ ( await response.text().catch( () => `` ) ).slice( 0, 300 ) }` )

            const feed = create_sse_parser( on_data )
            const decoder = new TextDecoder()
            const reader = response.body.getReader()
            while( true ) {
                const { done, value } = await reader.read()
                if( done ) break
                feed( decoder.decode( value, { stream: true } ) )
            }

            if( timings ) on_chunk( { timings } )
            return full_text

        } catch ( error ) {

            if( controller.signal.aborted ) return full_text

            // The OS killed the server (memory) before any text: restart once
            if( error instanceof TypeError && !full_text && !is_retry && config ) {
                log.warn( `[mobile] Connection lost (${ error.message }) — restarting the model` )
                server = null
                return run_chat( messages, opts, on_chunk, true )
            }
            throw error

        } finally {
            if( abort_controller === controller ) abort_controller = null
        }

    }

    const chat = ( messages, opts ) => run_chat( messages, opts )

    const start_stream = async ( messages, opts ) => {
        try {
            return await run_chat( messages, opts, chunk => stream_tokens.emit( chunk ) )
        } finally {
            stream_done.emit()
        }
    }

    const abort = () => {
        abort_controller?.abort()
        abort_controller = null
    }

    return {

        native_inference: true,
        platform,

        get_system_info,
        get_system_locale: async () => navigator.language,

        load_model,
        unload_model,
        get_loaded_model,

        chat,
        start_stream,
        on_stream_token: stream_tokens.on,
        on_stream_done: stream_done.on,
        abort,

        list_models,
        delete_model,

        download_model,
        abort_download,
        on_download_progress: download_progress.on,

    }

}
