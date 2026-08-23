import { log } from 'mentie'
import { get_db } from '../stores/db'
import { get_browser_model_incompatibility } from './model_compatibility'

const HF_BASE_URL = import.meta.env.VITE_HF_BASE_URL || `https://huggingface.co`

/**
 * Builds the Hugging Face download URL for a model
 * @param {string} repo - Hugging Face repo (e.g., "TheBloke/model-GGUF")
 * @param {string} file_name - GGUF file name
 * @returns {string} Full download URL
 */
export const build_download_url = ( repo, file_name ) =>
    `${ HF_BASE_URL }/${ repo }/resolve/main/${ file_name }`

/**
 * Checks if a model is already cached (filesystem in Electron, IndexedDB in browser).
 * When expected_repo and expected_file are provided, also verifies the cached
 * model came from the same source — this handles registry changes (e.g. switching
 * from a broken GGUF publisher to a working one).
 * @param {string} model_id - Model identifier
 * @param {string} [expected_repo] - Expected hugging_face_repo value
 * @param {string} [expected_file] - Expected file_name value
 * @returns {Promise<boolean>}
 */
export const is_model_cached = async ( model_id, expected_repo, expected_file ) => {

    // In Electron, check the filesystem manifest via IPC
    if( window.electronAPI?.list_models ) {

        const models = await window.electronAPI.list_models()
        const cached = models.find( ( m ) => m.id === model_id )
        if( !cached ) {
            log.debug( `[download] Cache miss: ${ model_id } (electron)` )
            return false
        }

        // Verify the cache matches the expected source
        if( expected_repo && cached.hugging_face_repo !== expected_repo ) {
            log.warn( `[download] Cache stale for ${ model_id }: source changed, clearing` )
            await window.electronAPI.delete_model( model_id )
            return false
        }
        if( expected_file && cached.file_name !== expected_file ) {
            log.warn( `[download] Cache stale for ${ model_id }: source changed, clearing` )
            await window.electronAPI.delete_model( model_id )
            return false
        }

        return true

    }

    // Browser path: check IndexedDB
    const db = await get_db()
    const cached = await db.get( `models`, model_id )
    if( !cached ) return false

    // If caller provided expected source, verify the cache matches
    // A mismatch means the registry changed to a different GGUF file
    if( expected_repo && cached.hugging_face_repo !== expected_repo ) {
        log.warn( `[download] Cache stale for ${ model_id }: source changed, clearing` )
        await db.delete( `models`, model_id )
        return false
    }
    if( expected_file && cached.file_name !== expected_file ) {
        log.warn( `[download] Cache stale for ${ model_id }: source changed, clearing` )
        await db.delete( `models`, model_id )
        return false
    }

    log.debug( `[download] Cache hit: ${ model_id }` )
    return true

}

/**
 * Gets cached model metadata (without blob for performance)
 * @param {string} model_id
 * @returns {Promise<Object|null>}
 */
export const get_cached_model = async ( model_id ) => {

    const db = await get_db()
    return db.get( `models`, model_id )

}

/**
 * Downloads a GGUF model from Hugging Face with progress tracking.
 * In Electron, saves to the filesystem via IPC. In browser, stores in IndexedDB.
 *
 * @param {Object} model - Model definition
 * @param {string} model.id - Unique model ID
 * @param {string} model.hugging_face_repo - HF repo path
 * @param {string} model.file_name - GGUF filename
 * @param {string} model.name - Human-readable name
 * @param {string} model.category - Model tier
 * @param {number} model.file_size_bytes - Expected file size
 * @param {string} model.parameters_label - Parameter count label
 * @param {string} model.quantization - Quantization label
 * @param {number} model.context_length - Context window
 * @param {Function} on_progress - Progress callback ({ progress, bytes_loaded, bytes_total, status })
 * @param {AbortSignal} [signal] - Abort signal for cancellation
 * @returns {Promise<void>}
 */
export const download_model = async ( model, on_progress, signal ) => {

    const url = build_download_url( model.hugging_face_repo, model.file_name )

    const size_mb = ( model.file_size_bytes / 1e6 ).toFixed( 0 )
    log.info( `[download] Starting: ${ model.name } (${ size_mb } MB)` )

    on_progress( { progress: 0, bytes_loaded: 0, bytes_total: model.file_size_bytes, status: `Starting download...` } )

    // In Electron, delegate to the main process which streams directly to disk.
    // This avoids buffering multi-GB files in the renderer's V8 heap.
    if( window.electronAPI?.download_model ) {

        log.debug( `[download] Using Electron IPC download` )

        // Forward progress events from main process
        const cleanup = window.electronAPI.on_download_progress( on_progress )

        // Wire up abort signal to main process
        const abort_handler = () => window.electronAPI.abort_download()
        if( signal ) signal.addEventListener( `abort`, abort_handler )

        try {
            await window.electronAPI.download_model( {
                url,
                id: model.id,
                file_name: model.file_name,
                expected_size: model.file_size_bytes,
                metadata: {
                    name: model.name,
                    category: model.category,
                    hugging_face_repo: model.hugging_face_repo,
                    file_name: model.file_name,
                    parameters_label: model.parameters_label,
                    quantization: model.quantization,
                    context_length: model.context_length,
                },
            } )
        } catch ( err ) {
            if( err?.message?.includes( `abort` ) ) {
                throw Object.assign( new Error( `Download aborted` ), { name: `AbortError` } )
            }
            throw err
        } finally {
            cleanup()
            if( signal ) signal.removeEventListener( `abort`, abort_handler )
        }

        return

    }

    // Browser path: download in renderer and store in IndexedDB
    const browser_incompatibility = get_browser_model_incompatibility( model )
    if( browser_incompatibility ) throw new Error( browser_incompatibility )

    const response = await fetch( url, { signal } )

    if( !response.ok ) {
        throw new Error( `Download failed: ${ response.status } ${ response.statusText }` )
    }

    const content_length = parseInt( response.headers.get( `content-length` ) ) || model.file_size_bytes
    const reader = response.body.getReader()
    const chunks = []
    let bytes_loaded = 0

    // Stream the response and track progress
    while( true ) {

        const { done, value } = await reader.read()
        if( done ) break

        chunks.push( value )
        bytes_loaded += value.length

        const progress = content_length > 0 ? bytes_loaded / content_length : 0

        on_progress( {
            progress: Math.min( progress, 1 ),
            bytes_loaded,
            bytes_total: content_length,
            status: `Downloading...`,
        } )

    }

    on_progress( { progress: 1, bytes_loaded, bytes_total: content_length, status: `Saving to cache...` } )

    // Combine chunks into a single blob. Large browser downloads can fail here
    // before IndexedDB sees the file, so convert low-level allocation errors.
    let blob
    try {
        blob = new Blob( chunks )
    } catch ( err ) {
        log.error( `[download] Could not prepare browser model blob`, err )
        throw new Error( `Could not prepare this model in browser memory. Try a smaller quantization or use the desktop app.` )
    }

    // Validate GGUF magic number — catches corrupt downloads, HTML error pages, or redirect bodies
    const header = new Uint8Array( await blob.slice( 0, 4 ).arrayBuffer() )
    const is_valid_gguf = header[ 0 ] === 0x47 && header[ 1 ] === 0x47 && header[ 2 ] === 0x55 && header[ 3 ] === 0x46
    if( !is_valid_gguf ) {
        log.warn( `[download] GGUF validation failed — file may be corrupt` )
        throw new Error( `Downloaded file is not a valid GGUF model. The file may be corrupted or the URL may have redirected to an error page.` )
    }

    const now = Date.now()
    const db = await get_db()
    try {
        await db.put( `models`, {
            id: model.id,
            blob,
            cached_at: now,
            file_size_bytes: blob.size,
            name: model.name,
            category: model.category,
            hugging_face_repo: model.hugging_face_repo,
            file_name: model.file_name,
            parameters_label: model.parameters_label,
            quantization: model.quantization,
            context_length: model.context_length,
            last_used_at: now,
        } )
    } catch ( err ) {
        const message = err.message || ``
        const is_storage_error = /quota|storage|memory|alloc|too large|large|transaction/i.test( message )

        if( is_storage_error ) {
            log.error( `[download] Could not save browser model blob`, err )
            throw new Error( `Could not save this model in browser storage. Free some space, choose a smaller quantization, or use the desktop app.` )
        }

        throw err
    }

    log.info( `[download] Complete: ${ model.name } (${ ( blob.size / 1e6 ).toFixed( 0 ) } MB)` )
    on_progress( { progress: 1, bytes_loaded: blob.size, bytes_total: blob.size, status: `Complete` } )

}
