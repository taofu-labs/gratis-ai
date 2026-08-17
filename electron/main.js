const { app, BrowserWindow, ipcMain, utilityProcess, session } = require( `electron` )
const { autoUpdater } = require( `electron-updater` )
const path = require( `path` )
const fs = require( `fs` )
const os = require( `os` )

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

    const budget = os.totalmem() * MEMORY_FRACTION
    const available = budget - ( model.file_size_bytes || 0 ) - RUNTIME_OVERHEAD

    if( available <= 0 ) return FALLBACK

    // Round down to nearest 256 for clean alignment
    const estimated = Math.floor( available / kv_per_token / 256 ) * 256

    return Math.max( FALLBACK, Math.min( max_ctx, estimated ) )

}

/**
 * Create the main application window
 */
const create_window = () => {

    main_window = new BrowserWindow( {
        width: 1536,
        height: 960,
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

    // Download a model by streaming directly to disk — avoids buffering
    // the entire file in renderer memory (which fails for large models)
    ipcMain.handle( `llm:download_model`, async ( _event, { url, id, file_name, metadata, expected_size } ) => {

        ensure_models_dir()

        active_download_controller = new AbortController()
        const model_path = path.join( MODELS_DIR, file_name )

        try {

            const response = await fetch( url, { signal: active_download_controller.signal } )
            if( !response.ok ) throw new Error( `Download failed: ${ response.status } ${ response.statusText }` )

            const content_length = parseInt( response.headers.get( `content-length` ) ) || expected_size || 0
            const reader = response.body.getReader()
            let bytes_loaded = 0
            let last_progress_time = 0

            // Stream chunks directly to disk — never holds the full file in memory
            let fd
            try {

                fd = fs.openSync( model_path, `w`, 0o644 )

                while( true ) {

                    const { done, value } = await reader.read()
                    if( done ) break

                    fs.writeSync( fd, value )
                    bytes_loaded += value.byteLength

                    // Throttle progress events to ~4 updates/sec
                    const now = Date.now()
                    if( now - last_progress_time >= 250 ) {
                        last_progress_time = now
                        main_window?.webContents?.send( `llm:download-progress`, {
                            progress: content_length > 0 ? bytes_loaded / content_length : 0,
                            bytes_loaded,
                            bytes_total: content_length,
                            status: `Downloading...`,
                        } )
                    }

                }

                fs.fsyncSync( fd )

            } finally {
                if( fd !== undefined ) fs.closeSync( fd )
            }

            // Verify written size matches expected
            const written_size = fs.statSync( model_path ).size
            if( content_length > 0 && written_size !== content_length ) {
                fs.unlinkSync( model_path )
                throw new Error( `Size mismatch: expected ${ content_length }, wrote ${ written_size }` )
            }

            // Update manifest
            const manifest = read_manifest()
            const now = Date.now()
            const existing_index = manifest.findIndex( ( m ) => m.id === id )
            if( existing_index !== -1 ) manifest.splice( existing_index, 1 )

            manifest.push( {
                ...metadata,
                id,
                file_name,
                file_size_bytes: written_size,
                cached_at: now,
                last_used_at: now,
            } )

            write_manifest( manifest )

            // Final progress event
            main_window?.webContents?.send( `llm:download-progress`, {
                progress: 1,
                bytes_loaded: written_size,
                bytes_total: written_size,
                status: `Complete`,
            } )

            return { success: true }

        } catch( err ) {
            // Clean up partial file on failure
            if( fs.existsSync( model_path ) ) fs.unlinkSync( model_path )
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

    // Load a model by ID — resolves the path here, sends to worker for loading
    ipcMain.handle( `llm:load`, async ( _event, model_id, options = {} ) => {

        const manifest = read_manifest()
        const model = manifest.find( ( m ) => m.id === model_id )
        if( !model ) throw new Error( `Model not found: ${ model_id }` )

        const model_path = path.join( MODELS_DIR, model.file_name )
        if( !fs.existsSync( model_path ) ) throw new Error( `Model file missing: ${ model.file_name }` )

        // Estimate the largest context that fits in available memory. Use 70%
        // of total RAM as the budget (headroom for OS, Electron, V8 heap).
        // If we overshoot, the worker's VRAM retry loop will halve down safely.
        const context_override = parseInt( options.context_length, 10 )
        const requested_ctx = Number.isFinite( context_override ) && context_override > 0
            ? context_override
            : estimate_context_for_system( model )

        const result = await worker_request( `load`, {
            model_path,
            opts: { n_ctx: requested_ctx },
        } )

        // Update last_used_at
        model.last_used_at = Date.now()
        write_manifest( manifest )

        return {
            success: true,
            context_size: result.context_size,
            context_reduced: result.context_size < requested_ctx,
        }

    } )

    // Single-shot chat completion — forwarded to worker
    ipcMain.handle( `llm:chat`, ( _event, messages, opts ) => {
        return worker_request( `chat`, { messages, opts } )
    } )

    // Streaming chat — worker sends stream-token / stream-done events
    // which the message handler above forwards to the renderer
    ipcMain.handle( `llm:chat_stream`, ( _event, messages, opts ) => {
        return worker_request( `chat_stream`, { messages, opts } )
    } )

    // Abort current generation
    ipcMain.handle( `llm:abort`, () => worker_request( `abort` ) )

    // Unload the current model
    ipcMain.handle( `llm:unload`, () => worker_request( `unload` ) )

    // Get current model status
    ipcMain.handle( `llm:status`, () => worker_request( `status` ) )

    // List all cached models
    ipcMain.handle( `llm:list_models`, async () => {

        return read_manifest()

    } )

    // Delete a model
    ipcMain.handle( `llm:delete_model`, async ( _event, model_id ) => {

        const manifest = read_manifest()
        const index = manifest.findIndex( ( m ) => m.id === model_id )
        if( index === -1 ) throw new Error( `Model not found` )

        const model = manifest[ index ]
        const model_path = path.join( MODELS_DIR, model.file_name )

        // Remove from manifest
        manifest.splice( index, 1 )
        write_manifest( manifest )

        // Delete file
        if( fs.existsSync( model_path ) ) {
            fs.unlinkSync( model_path )
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
        } catch( err ) {
            console.error( `[updater] Check failed:`, err?.message || err )
            return { status: `error`, message: err?.message || `Update check failed` }
        }
    } )

    ipcMain.handle( `updater:download`, async () => {
        if( !_updater_active ) return { status: `unavailable` }
        try {
            await autoUpdater.downloadUpdate()
            return { status: `ok` }
        } catch( err ) {
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

// App lifecycle
app.whenReady().then( () => {

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

    shutdown_worker().then( () => app.quit() )

} )

app.on( `window-all-closed`, () => {
    if( process.platform !== `darwin` || _is_quitting ) app.quit()
} )
