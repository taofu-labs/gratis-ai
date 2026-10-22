const { app, BrowserWindow, ipcMain, utilityProcess, session } = require( `electron` )
const { autoUpdater } = require( `electron-updater` )
const path = require( `path` )
const fs = require( `fs` )
const os = require( `os` )
const { LlamaServer, resolve_server_binary } = require( `./llama_server.js` )
const { mmproj_local_name, has_gguf_magic } = require( `./model_files.js` )

// ---------------------------------------------------
// Console forwarding — pipes Node.js console output
// from main + worker into the browser DevTools console
// ---------------------------------------------------

const _log_buffer = []
let _renderer_ready = false

const _serialise_arg = ( arg ) => {
    if( typeof arg === `object` ) try { return JSON.stringify( arg ) } catch { return String( arg ) }
    return String( arg )
}

const _forward_log = ( level, args ) => {

    const entry = { level, message: args.map( _serialise_arg ).join( ` ` ) }

    if( _renderer_ready && main_window?.webContents ) {
        main_window.webContents.send( `nodejs:console`, entry )
    } else {
        _log_buffer.push( entry )
    }

}

const _flush_log_buffer = () => {

    _renderer_ready = true

    for( const entry of _log_buffer ) {
        main_window?.webContents?.send( `nodejs:console`, entry )
    }

    _log_buffer.length = 0

}

// Monkey-patch console methods to forward to renderer
for( const level of [ `log`, `info`, `warn`, `error`, `debug` ] ) {

    const original = console[ level ].bind( console )

    console[ level ] = ( ...args ) => {
        original( ...args )
        _forward_log( level, args )
    }

}

let main_window = null
let inference_worker = null
let active_download_controller = null
let _is_quitting = false
let _updater_active = false

// ---------------------------------------------------
// Vision sidecar — models with an mmproj projector run in
// a bundled llama-server (node-llama-cpp has no multimodal)
// ---------------------------------------------------

let _llama_server = null

/**
 * Lazily create the sidecar controller (does not spawn anything yet)
 * @returns {LlamaServer}
 */
const get_llama_server = () => {

    if( _llama_server ) return _llama_server

    const binary_path = resolve_server_binary( {
        is_packaged: app.isPackaged,
        resources_path: process.resourcesPath,
        app_root: app.getAppPath(),
    } )

    _llama_server = new LlamaServer( { binary_path } )
    return _llama_server

}

/** True when the vision sidecar owns the loaded model */
const sidecar_active = () => !!_llama_server?.is_active()

// Last-chance cleanup so a hard exit never leaves the sidecar running
process.on( `exit`, () => _llama_server?.kill_sync() )

// ---------------------------------------------------
// Inference worker bridge — spawns a utilityProcess
// so model loading + inference never block the UI
// ---------------------------------------------------

let _request_id = 0
const _pending = new Map()

/**
 * Spawn (or return existing) inference utilityProcess
 * @returns {Electron.UtilityProcess}
 */
const ensure_worker = () => {

    if( inference_worker ) return inference_worker

    inference_worker = utilityProcess.fork(
        path.join( __dirname, `inference_worker.js` ),
    )

    inference_worker.on( `message`, ( msg ) => {

        // Worker console output — relay to renderer via the same forwarding pipeline
        if( msg.type === `console-log` ) {
            _forward_log( msg.payload.level, [ msg.payload.message ] )
            return
        }

        // Unsolicited stream events — forward straight to the renderer
        if( msg.type === `stream-token` ) {
            main_window?.webContents?.send( `llm:stream-token`, msg.payload )
            return
        }
        if( msg.type === `stream-done` ) {
            main_window?.webContents?.send( `llm:stream-done` )
            return
        }

        // Request/response — resolve or reject the matching promise
        const pending = _pending.get( msg.id )
        if( !pending ) return

        _pending.delete( msg.id )

        if( msg.type === `error` ) {
            pending.reject( new Error( msg.payload ) )
        } else {
            pending.resolve( msg.payload )
        }

    } )

    // If the worker crashes, clear state so it gets re-spawned on next call.
    // During graceful shutdown we skip the "reject pending" logic — those
    // requests are already irrelevant and the error noise confuses cleanup.
    inference_worker.on( `exit`, () => {

        inference_worker = null

        if( _is_quitting ) return

        // Reject any in-flight requests
        for( const [ , pending ] of _pending ) {
            pending.reject( new Error( `Inference worker exited unexpectedly` ) )
        }
        _pending.clear()

    } )

    return inference_worker

}

/**
 * Send a request to the inference worker and await the response
 * @param {string} type - Message type (load, chat, chat_stream, etc.)
 * @param {*} [payload] - Message payload
 * @returns {Promise<*>}
 */
const worker_request = ( type, payload ) => {

    return new Promise( ( resolve, reject ) => {

        const id = ++_request_id
        _pending.set( id, { resolve, reject } )
        ensure_worker().postMessage( { id, type, payload } )

    } )

}

/**
 * Gracefully shut down the inference worker — cancels generation,
 * frees GPU/mmap resources, then waits for the process to exit.
 * Falls back to force-kill after 4 seconds if the worker is stuck.
 * @returns {Promise<void>}
 */
const shutdown_worker = () => {

    if( !inference_worker ) return Promise.resolve()

    return new Promise( ( resolve ) => {

        const timeout = setTimeout( () => {
            // Worker stuck in native code — force-kill
            if( inference_worker ) inference_worker.kill()
            resolve()
        }, 4_000 )

        inference_worker.on( `exit`, () => {
            clearTimeout( timeout )
            resolve()
        } )

        inference_worker.postMessage( { id: ++_request_id, type: `shutdown` } )

    } )

}

// Models directory in user data
const MODELS_DIR = path.join( app.getPath( `userData` ), `models` )
const MANIFEST_PATH = path.join( MODELS_DIR, `models_manifest.json` )

/**
 * Ensure the models directory and manifest exist
 */
const ensure_models_dir = () => {

    if( !fs.existsSync( MODELS_DIR ) ) {
        fs.mkdirSync( MODELS_DIR, { recursive: true } )
    }

    if( !fs.existsSync( MANIFEST_PATH ) ) {
        fs.writeFileSync( MANIFEST_PATH, JSON.stringify( [], null, 2 ) )
    }

}

/**
 * Read the models manifest
 * @returns {Array} Array of model metadata objects
 */
const read_manifest = () => {

    try {
        return JSON.parse( fs.readFileSync( MANIFEST_PATH, `utf-8` ) )
    } catch {
        return []
    }

}

/**
 * Write the models manifest
 * @param {Array} manifest - Array of model metadata objects
 */
const write_manifest = ( manifest ) => {
    fs.writeFileSync( MANIFEST_PATH, JSON.stringify( manifest, null, 2 ) )
}

/**
 * Estimate the best context size for this system and model.
 *
 * Uses the model's architecture data (layers, kv_heads, head_dim) to compute
 * KV cache cost per token, then works out how many tokens fit in 70% of
 * total RAM (leaving headroom for OS, Electron, V8). The result is clamped
 * to the model's advertised context_length so we never exceed what the
 * architecture supports.
 *
 * If architecture data is missing (custom imports), falls back to 2048.
 * The worker's VRAM retry loop catches any overestimation — this just
 * gives it a smarter starting point than a hard-coded cap.
 *
 * @param {Object} model - Model manifest entry
 * @returns {number} Context size to request
 */
const estimate_context_for_system = ( model ) => {

    const FALLBACK = 2048
    const RUNTIME_OVERHEAD = 500_000_000
    const MEMORY_FRACTION = 0.7
    const max_ctx = model.context_length || FALLBACK

    if( !model.layers || !model.kv_heads || !model.head_dim ) return max_ctx

    // KV cache = 2 (key + value) × layers × kv_heads × head_dim × 2 bytes (FP16) per token
    const kv_per_token = 2 * model.layers * model.kv_heads * model.head_dim * 2

    // The vision projector lives in the same memory as the weights
    const weights_bytes = ( model.file_size_bytes || 0 ) + ( model.mmproj_size_bytes || 0 )
    const budget = os.totalmem() * MEMORY_FRACTION
    const available = budget - weights_bytes - RUNTIME_OVERHEAD

    if( available <= 0 ) return FALLBACK

    // Round down to nearest 256 for clean alignment
    const estimated = Math.floor( available / kv_per_token / 256 ) * 256

    return Math.max( FALLBACK, Math.min( max_ctx, estimated ) )

}

/**
 * Absolute path of a model's vision projector, or null when it has none
 * @param {Object} model - Manifest entry
 * @returns {string|null}
 */
const mmproj_path_for = ( model ) => model.mmproj_file_name
    ? path.join( MODELS_DIR, mmproj_local_name( model.file_name, model.mmproj_file_name ) )
    : null

/**
 * Drop attachments before handing messages to node-llama-cpp — it is text-only,
 * and there is no point copying image bytes into the worker.
 * @param {Array} messages
 * @returns {Array}
 */
const strip_attachments = ( messages ) => messages.map( ( { attachments, ...message } ) => message )

/**
 * Turn a failed Hugging Face response into a user-facing error
 * @param {Response} response
 * @returns {Error}
 */
const download_error = ( response ) => {

    if( response.status === 401 || response.status === 403 ) {
        return new Error( `Hugging Face rejected the token or this account does not have access to the model. Check the read token in Settings > Models.` )
    }
    if( response.status === 429 ) {
        return new Error( `Hugging Face is throttling this download. Add a read token in Settings > Models or retry after the limit resets.` )
    }
    return new Error( `Download failed: ${ response.status } ${ response.statusText }` )

}

/**
 * Stream one URL to disk via a `.part` file, renamed only once complete
 * and GGUF-valid. Never holds the full file in memory.
 * @param {Object} params
 * @param {string} params.url
 * @param {string} params.dest - Final file path
 * @param {Object} params.request_options - fetch options (signal, headers)
 * @param {( total: number ) => void} params.on_total - Called with the real size once known
 * @param {( bytes: number ) => void} params.on_bytes - Called per written chunk
 * @returns {Promise<number>} Bytes written
 */
const download_gguf = async ( { url, dest, request_options, on_total, on_bytes } ) => {

    const part_path = `${ dest }.part`

    try {

        const response = await fetch( url, request_options )
        if( !response.ok ) throw download_error( response )

        const content_length = parseInt( response.headers.get( `content-length` ) ) || 0
        if( content_length ) on_total( content_length )

        const reader = response.body.getReader()
        let fd
        try {

            fd = fs.openSync( part_path, `w`, 0o644 )

            while( true ) {
                const { done, value } = await reader.read()
                if( done ) break
                fs.writeSync( fd, value )
                on_bytes( value.byteLength )
            }

            // Flush before node-llama-cpp / llama-server mmap() the file
            fs.fsyncSync( fd )

        } finally {
            if( fd !== undefined ) fs.closeSync( fd )
        }

        const written_size = fs.statSync( part_path ).size
        if( content_length > 0 && written_size !== content_length ) {
            throw new Error( `Size mismatch: expected ${ content_length }, wrote ${ written_size }` )
        }
        if( !has_gguf_magic( part_path ) ) {
            throw new Error( `Downloaded file is not a GGUF model: ${ path.basename( dest ) }` )
        }

        fs.renameSync( part_path, dest )
        return written_size

    } catch ( err ) {
        if( fs.existsSync( part_path ) ) fs.unlinkSync( part_path )
        throw err
    }

}

/**
 * True when a file is already on disk at the expected size with a GGUF header —
 * lets "add image support" fetch only the projector for an installed model.
 * @param {string} file_path
 * @param {number} [expected_size]
 * @returns {boolean}
 */
const is_complete_gguf = ( file_path, expected_size ) => !!expected_size
    && fs.existsSync( file_path )
    && fs.statSync( file_path ).size === expected_size
    && has_gguf_magic( file_path )

/**
 * Create the main application window
 */
const create_window = () => {

    main_window = new BrowserWindow( {
        width: 1536,
        height: 960,
        minWidth: 480,
        minHeight: 600,
        webPreferences: {
            preload: path.join( __dirname, `../preload/preload.cjs` ),
            contextIsolation: true,
            nodeIntegration: false,
        },
    } )

    // Load the renderer
    if( process.env.NODE_ENV === `development` ) {
        main_window.loadURL( `http://localhost:5173` )
    } else {
        main_window.loadFile( path.join( __dirname, `../renderer/index.html` ) )
    }

    // Flush buffered console logs once the renderer is ready to receive them
    main_window.webContents.on( `did-finish-load`, _flush_log_buffer )

}

/**
 * Register all IPC handlers for LLM operations
 */
const register_ipc_handlers = () => {

    // System locale — used by the renderer to sync i18n with the OS language
    ipcMain.handle( `system:locale`, () => app.getLocale() )

    // System info — GPU detection runs in the worker to avoid blocking the UI
    // on the first getLlama() call (which compiles/loads native backends)
    ipcMain.handle( `system:info`, () => worker_request( `system:info` ) )

    // Save a downloaded model to the filesystem
    ipcMain.handle( `llm:save_model`, async ( _event, { id, file_name, array_buffer, metadata } ) => {

        ensure_models_dir()

        // Write the GGUF file with explicit fsync to ensure data is flushed
        // before node-llama-cpp mmap()s the file
        const model_path = path.join( MODELS_DIR, file_name )
        const buffer = Buffer.from( array_buffer )
        let fd
        try {
            fd = fs.openSync( model_path, 'w', 0o644 )
            fs.writeSync( fd, buffer, 0, buffer.length )
            fs.fsyncSync( fd )
        } finally {
            if( fd !== undefined ) fs.closeSync( fd )
        }

        // Verify the written file matches expected size
        const written_size = fs.statSync( model_path ).size
        if( written_size !== buffer.length ) {
            throw new Error( `Model file size mismatch: expected ${ buffer.length } bytes, wrote ${ written_size }` )
        }

        // Update manifest
        const manifest = read_manifest()
        const now = Date.now()

        // Remove existing entry if present (re-download)
        const existing_index = manifest.findIndex( ( m ) => m.id === id )
        if( existing_index !== -1 ) manifest.splice( existing_index, 1 )

        manifest.push( {
            ...metadata,
            id,
            file_name,
            file_size_bytes: array_buffer.byteLength,
            cached_at: now,
            last_used_at: now,
        } )

        write_manifest( manifest )

        return { success: true }

    } )

    // Download a model (and its vision projector, if any) by streaming directly
    // to disk — avoids buffering multi-GB files in renderer memory. Progress is
    // summed over both files; the manifest entry is written only once both are
    // on disk and GGUF-valid, so a model is never "installed" half-way.
    ipcMain.handle( `llm:download_model`, async ( _event, { url, id, file_name, metadata, expected_size, headers = {}, mmproj } ) => {

        ensure_models_dir()

        active_download_controller = new AbortController()

        const request_headers = Object.fromEntries(
            Object.entries( headers || {} )
                .filter( ( [ key, value ] ) => key && typeof value === `string` )
        )
        const request_options = {
            signal: active_download_controller.signal,
            ... Object.keys( request_headers ).length ? { headers: request_headers } : {},
        }

        // Everything this call needs on disk, model first
        const files = [
            { url, dest: path.join( MODELS_DIR, file_name ), expected_size },
            ... mmproj ? [ {
                url: mmproj.url,
                dest: path.join( MODELS_DIR, mmproj_local_name( file_name, mmproj.file_name ) ),
                expected_size: mmproj.expected_size,
            } ] : [],
        ]

        // Summed progress — sizes start from the catalog and are corrected by content-length
        const totals = files.map( ( file ) => file.expected_size || 0 )
        let bytes_loaded = 0
        let last_progress_time = 0

        const send_progress = ( status, force = false ) => {
            const now = Date.now()
            if( !force && now - last_progress_time < 250 ) return
            last_progress_time = now
            const bytes_total = totals.reduce( ( sum, size ) => sum + size, 0 )
            main_window?.webContents?.send( `llm:download-progress`, {
                progress: bytes_total > 0 ? Math.min( bytes_loaded / bytes_total, 1 ) : 0,
                bytes_loaded,
                bytes_total,
                status,
            } )
        }

        // Files written by this call, removed again if anything fails
        const written = []

        try {

            for( const [ index, file ] of files.entries() ) {

                // Already complete (e.g. adding image support to an installed model)
                if( is_complete_gguf( file.dest, file.expected_size ) ) {
                    bytes_loaded += file.expected_size
                    continue
                }

                const size = await download_gguf( {
                    url: file.url,
                    dest: file.dest,
                    request_options,
                    on_total: ( total ) => totals[ index ] = total,
                    on_bytes: ( bytes ) => {
                        bytes_loaded += bytes
                        send_progress( `Downloading...` )
                    },
                } )

                written.push( file.dest )
                file.size = size

            }

            // Update manifest
            const [ model_file, mmproj_file ] = files
            const manifest = read_manifest()
            const now = Date.now()
            const existing_index = manifest.findIndex( ( m ) => m.id === id )
            const previous = existing_index === -1 ? null : manifest[ existing_index ]
            if( existing_index !== -1 ) manifest.splice( existing_index, 1 )

            manifest.push( {
                ...metadata,
                id,
                file_name,
                file_size_bytes: fs.statSync( model_file.dest ).size,
                ... mmproj ? {
                    mmproj_file_name: mmproj.file_name,
                    mmproj_size_bytes: fs.statSync( mmproj_file.dest ).size,
                } : {},
                cached_at: previous?.cached_at || now,
                last_used_at: now,
            } )

            write_manifest( manifest )
            send_progress( `Complete`, true )

            return { success: true }

        } catch ( err ) {
            // Clean up files this call created — never a pre-existing installed model
            for( const dest of written ) if( fs.existsSync( dest ) ) fs.unlinkSync( dest )
            throw err
        } finally {
            active_download_controller = null
        }

    } )

    // Abort an in-progress download
    ipcMain.handle( `llm:abort_download`, async () => {

        if( active_download_controller ) {
            active_download_controller.abort()
            active_download_controller = null
        }
        return { success: true }

    } )

    // Load a model by ID. Models with a downloaded vision projector run in the
    // llama-server sidecar; everything else in the node-llama-cpp worker.
    // Only one backend holds a model at a time — the other is unloaded first.
    ipcMain.handle( `llm:load`, async ( _event, model_id ) => {

        const manifest = read_manifest()
        const model = manifest.find( ( m ) => m.id === model_id )
        if( !model ) throw new Error( `Model not found: ${ model_id }` )

        const model_path = path.join( MODELS_DIR, model.file_name )
        if( !fs.existsSync( model_path ) ) throw new Error( `Model file missing: ${ model.file_name }` )

        // Estimate the largest context that fits in available memory. Use 70%
        // of total RAM as the budget (headroom for OS, Electron, V8 heap).
        // If we overshoot, the worker's VRAM retry loop will halve down safely.
        const requested_ctx = estimate_context_for_system( model )

        // Update last_used_at
        model.last_used_at = Date.now()
        write_manifest( manifest )

        const mmproj_path = mmproj_path_for( model )
        const wants_vision = mmproj_path && fs.existsSync( mmproj_path )

        if( wants_vision ) {

            // Free node-llama-cpp's copy before the sidecar maps its own
            if( inference_worker ) await worker_request( `unload` )

            try {

                const info = await get_llama_server().start( {
                    model_id,
                    model_path,
                    mmproj_path,
                    n_ctx: requested_ctx,
                    reasoning_enabled: model.reasoning_enabled,
                } )

                return {
                    success: true,
                    context_size: info.context_size,
                    context_reduced: info.context_size < ( model.context_length || requested_ctx ),
                    has_image_input: info.has_image_input,
                    has_projector: true,
                }

            } catch ( err ) {
                // Missing binary or a sidecar that cannot start: keep text chat working
                console.warn( `[llama-server] Vision sidecar unavailable, loading text-only: ${ err.message }` )
                await _llama_server?.stop()
            }

        }

        // Text-only path — stop the sidecar first so its memory is released
        await _llama_server?.stop()

        const result = await worker_request( `load`, {
            model_path,
            opts: { n_ctx: requested_ctx },
        } )

        return {
            success: true,
            context_size: result.context_size,
            context_reduced: result.context_size < ( model.context_length || requested_ctx ),
            has_image_input: false,
            has_projector: !!wants_vision,
        }

    } )

    // Single-shot chat completion
    ipcMain.handle( `llm:chat`, ( _event, messages, opts ) => {
        if( sidecar_active() ) return _llama_server.chat_stream( messages, opts )
        return worker_request( `chat`, { messages: strip_attachments( messages ), opts } )
    } )

    // Streaming chat — both backends emit the same stream-token / stream-done
    // events, so the renderer provider does not care which one is running.
    // Sidecar chunks may also be `{ prompt_progress }` / `{ timings }` objects.
    ipcMain.handle( `llm:chat_stream`, async ( _event, messages, opts ) => {

        if( !sidecar_active() ) return worker_request( `chat_stream`, { messages: strip_attachments( messages ), opts } )

        try {
            await _llama_server.chat_stream( messages, opts, ( chunk ) => {
                main_window?.webContents?.send( `llm:stream-token`, chunk )
            } )
        } finally {
            main_window?.webContents?.send( `llm:stream-done` )
        }

        return { success: true }

    } )

    // Abort current generation
    ipcMain.handle( `llm:abort`, () => {
        if( sidecar_active() ) return _llama_server.abort()
        return worker_request( `abort` )
    } )

    // Unload the current model from whichever backend holds it
    ipcMain.handle( `llm:unload`, async () => {
        await _llama_server?.stop()
        if( inference_worker ) await worker_request( `unload` )
        return { success: true }
    } )

    // Get current model status
    ipcMain.handle( `llm:status`, () => {
        if( sidecar_active() ) return { loaded: true, model_id: _llama_server.config.model_id, has_image_input: true }
        return worker_request( `status` )
    } )

    // List all cached models
    ipcMain.handle( `llm:list_models`, async () => {

        return read_manifest()

    } )

    // Delete a model and its vision projector
    ipcMain.handle( `llm:delete_model`, async ( _event, model_id ) => {

        const manifest = read_manifest()
        const index = manifest.findIndex( ( m ) => m.id === model_id )
        if( index === -1 ) throw new Error( `Model not found` )

        const model = manifest[ index ]

        // The sidecar holds the files open (Windows refuses to delete them)
        if( _llama_server?.config?.model_id === model_id ) await _llama_server.stop()

        // Remove from manifest
        manifest.splice( index, 1 )
        write_manifest( manifest )

        // Delete files
        for( const file_path of [ path.join( MODELS_DIR, model.file_name ), mmproj_path_for( model ) ] ) {
            if( file_path && fs.existsSync( file_path ) ) fs.unlinkSync( file_path )
        }

        return { success: true }

    } )

    // Auto-updater IPC — registered unconditionally so the renderer
    // never hits "No handler registered" errors, even in dev mode
    ipcMain.handle( `updater:check`, async () => {
        if( !_updater_active ) return { status: `unavailable` }
        try {
            const result = await autoUpdater.checkForUpdates()
            return { status: `ok`, version: result?.updateInfo?.version }
        } catch ( err ) {
            console.error( `[updater] Check failed:`, err?.message || err )
            return { status: `error`, message: err?.message || `Update check failed` }
        }
    } )

    ipcMain.handle( `updater:download`, async () => {
        if( !_updater_active ) return { status: `unavailable` }
        try {
            await autoUpdater.downloadUpdate()
            return { status: `ok` }
        } catch ( err ) {
            console.error( `[updater] Download failed:`, err?.message || err )
            return { status: `error`, message: err?.message || `Download failed` }
        }
    } )

    ipcMain.handle( `updater:install`, () => {
        if( !_updater_active ) return { status: `unavailable` }
        autoUpdater.quitAndInstall()
    } )

}

// ---------------------------------------------------
// Auto-updater — checks GitHub Releases for new versions
// ---------------------------------------------------

const setup_auto_updater = () => {

    // Skip in dev — no packaged app to update.
    // electron-updater reads app-update.yml from the packaged resources
    // automatically, so we must NOT call setFeedURL() manually.
    if( !app.isPackaged ) return

    // Linux can only self-update an AppImage; other installs have no APPIMAGE env and the updater would error
    if( process.platform === `linux` && !process.env.APPIMAGE ) {
        console.log( `[updater] Not running from an AppImage, auto-update disabled` )
        return
    }

    _updater_active = true

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    // Forward updater events to the renderer
    const send = ( channel, data ) => {
        main_window?.webContents?.send( channel, data )
    }

    autoUpdater.on( `checking-for-update`, () => {
        console.log( `[updater] Checking for update...` )
    } )

    autoUpdater.on( `update-available`, ( info ) => {
        console.log( `[updater] Update available: v${ info.version }` )
        send( `updater:available`, {
            version: info.version,
            release_notes: info.releaseNotes || ``,
        } )
    } )

    autoUpdater.on( `update-not-available`, ( info ) => {
        console.log( `[updater] Up to date (current: v${ info.version })` )
        send( `updater:not-available` )
    } )

    autoUpdater.on( `download-progress`, ( progress ) => {
        send( `updater:download-progress`, {
            percent: Math.round( progress.percent ),
            bytes_per_second: progress.bytesPerSecond,
            transferred: progress.transferred,
            total: progress.total,
        } )
    } )

    autoUpdater.on( `update-downloaded`, ( info ) => {
        console.log( `[updater] Update downloaded: v${ info.version }` )
        send( `updater:downloaded`, { version: info.version } )
    } )

    autoUpdater.on( `error`, ( err ) => {
        console.error( `[updater] Error:`, err?.message || err )
        send( `updater:error`, { message: err?.message || `Update check failed` } )
    } )

    // Auto-check 5 seconds after launch
    setTimeout( () => {
        autoUpdater.checkForUpdates().catch( ( err ) => {
            console.error( `[updater] Auto-check failed:`, err?.message || err )
        } )
    }, 5_000 )

}

/**
 * Bypass CORS for RunPod API calls (Nerd Mode cloud inference).
 *
 * RunPod's REST and inference APIs don't return CORS headers, so the
 * renderer's fetch() would fail on preflight. We intercept responses
 * in the main process and inject the required headers. For OPTIONS
 * preflights that RunPod rejects (404/405), we override the status
 * to 204 so the browser proceeds with the actual request.
 */
const setup_runpod_cors = () => {

    const filter = { urls: [
        `https://rest.runpod.io/*`,
        `https://api.runpod.ai/*`,
        `https://api.runpod.io/*`,
    ] }

    session.defaultSession.webRequest.onHeadersReceived( filter, ( details, callback ) => {

        // Strip any existing CORS headers (case-insensitive) to avoid duplicates
        const headers = {}
        for( const [ key, value ] of Object.entries( details.responseHeaders ) ) {
            if( !key.toLowerCase().startsWith( `access-control-` ) ) headers[ key ] = value
        }

        headers[ `Access-Control-Allow-Origin` ] = [ `*` ]
        headers[ `Access-Control-Allow-Methods` ] = [ `GET, POST, PUT, DELETE, OPTIONS` ]
        headers[ `Access-Control-Allow-Headers` ] = [ `Content-Type, Authorization` ]

        // Force OPTIONS preflights to succeed even when RunPod returns 404/405
        if( details.method === `OPTIONS` ) {
            callback( { responseHeaders: headers, statusLine: `HTTP/1.1 204 No Content` } )
        } else {
            callback( { responseHeaders: headers } )
        }

    } )

}

// Single instance: a second launch would start a second inference worker on the same models dir
const has_instance_lock = app.requestSingleInstanceLock()
if( !has_instance_lock ) app.quit()

// Focus the existing window instead
app.on( `second-instance`, () => {
    if( !main_window ) return
    if( main_window.isMinimized() ) main_window.restore()
    main_window.focus()
} )

// App lifecycle
if( has_instance_lock ) app.whenReady().then( () => {

    ensure_models_dir()
    register_ipc_handlers()
    setup_runpod_cors()
    create_window()
    setup_auto_updater()

    app.on( `activate`, () => {
        if( BrowserWindow.getAllWindows().length === 0 ) create_window()
    } )

} )

// Graceful shutdown — clean up worker, abort downloads, then quit
app.on( `before-quit`, ( event ) => {

    // Guard: second fire after cleanup completes — let it through
    if( _is_quitting ) return

    _is_quitting = true
    event.preventDefault()

    // Abort any in-progress model download
    if( active_download_controller ) {
        active_download_controller.abort()
        active_download_controller = null
    }

    // Stop the vision sidecar and the node-llama-cpp worker in parallel
    const stop_sidecar = _llama_server?.stop().catch( () => {} )
    Promise.all( [ shutdown_worker(), stop_sidecar ] ).then( () => app.quit() )

} )

app.on( `window-all-closed`, () => {
    if( process.platform !== `darwin` || _is_quitting ) app.quit()
} )
