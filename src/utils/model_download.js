import { log } from 'mentie'
import { CacheManager, ModelManager, ModelValidationStatus } from 'wllama64'
import { get_db } from '../stores/db'
import { get_model_by_id } from './model_catalog'
import { ReliableOPFSBackend } from './reliable_opfs_backend'

const HF_BASE_URL = import.meta.env.VITE_HF_BASE_URL || `https://huggingface.co`

const WLLAMA_CACHE_LOGGER = {
    debug: ( ...args ) => log.debug( `[model-cache]`, ...args ),
    log: ( ...args ) => log.info( `[model-cache]`, ...args ),
    warn: ( ...args ) => log.warn( `[model-cache]`, ...args ),
    error: ( ...args ) => log.error( `[model-cache]`, ...args ),
}

let browser_model_manager = null

/**
 * Get the shared browser model manager backed by OPFS.
 * @returns {ModelManager}
 */
export const get_browser_model_manager = () => {
    if( !browser_model_manager ) {
        browser_model_manager = new ModelManager( {
            allowOffline: true,
            cacheManager: new CacheManager( [ new ReliableOPFSBackend() ] ),
            logger: WLLAMA_CACHE_LOGGER,
        } )
    }
    return browser_model_manager
}

/**
 * Return a validated OPFS model without triggering a network download.
 * Some Hugging Face/Xet responses omit Content-Length. Wllama records an
 * `originalSize` of zero in that case even though OPFS contains the complete
 * file, so validate against the catalog/API size as a safe fallback.
 * @param {string} download_url
 * @param {number} [expected_size]
 * @returns {Promise<import('wllama64').Model|null>}
 */
export const get_browser_cached_model = async ( download_url, expected_size ) => {

    const models = await get_browser_model_manager().getModels( { includeInvalid: true } )
    const stored_model = models.find( model => model.url === download_url )

    if( !stored_model ) return null
    if( stored_model.validate() === ModelValidationStatus.VALID ) return stored_model

    const stored_size = stored_model.files.reduce( ( total, file ) => total + file.size, 0 )
    return expected_size > 0 && stored_size === expected_size ? stored_model : null

}

const remove_browser_cache_entry = async ( cached ) => {

    if( cached?.download_url ) {
        try {
            const models = await get_browser_model_manager().getModels( { includeInvalid: true } )
            const stored_model = models.find( model => model.url === cached.download_url )
            if( stored_model ) await stored_model.remove()
        } catch ( error ) {
            // Metadata must still be cleared when OPFS itself is unavailable.
            log.warn( `[download] Could not remove OPFS cache entry:`, error )
        }
    }

    const db = await get_db()
    if( cached?.id ) await db.delete( `models`, cached.id )

}

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
        await remove_browser_cache_entry( cached )
        return false
    }
    if( expected_file && cached.file_name !== expected_file ) {
        log.warn( `[download] Cache stale for ${ model_id }: source changed, clearing` )
        await remove_browser_cache_entry( cached )
        return false
    }

    // Legacy versions stored the entire Blob in IndexedDB.
    if( cached.blob ) {
        log.debug( `[download] Cache hit: ${ model_id } (legacy IndexedDB)` )
        return true
    }

    if( !cached.download_url ) {
        await db.delete( `models`, model_id )
        return false
    }

    try {
        // Catalog size wins. A pre-0.41 interrupted download may have persisted
        // its truncated byte count as metadata and must not validate itself.
        const expected_size = get_model_by_id( model_id )?.file_size_bytes || cached.file_size_bytes
        const stored_model = await get_browser_cached_model( cached.download_url, expected_size )

        if( !stored_model ) {
            log.warn( `[download] OPFS cache invalid for ${ model_id }, clearing metadata` )
            await remove_browser_cache_entry( cached )
            return false
        }
    } catch ( error ) {
        log.warn( `[download] Could not validate OPFS cache for ${ model_id }:`, error )
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
 * Delete one browser model from OPFS and its IndexedDB metadata.
 * @param {Object|string} model_or_id - Cached model metadata or model ID
 * @returns {Promise<void>}
 */
export const delete_browser_model = async ( model_or_id ) => {

    const db = await get_db()
    const cached = typeof model_or_id === `string`
        ? await db.get( `models`, model_or_id )
        : model_or_id

    if( cached ) await remove_browser_cache_entry( cached )

}

/**
 * Clear every OPFS model downloaded through wllama64.
 * @returns {Promise<void>}
 */
export const clear_browser_model_cache = async () => {
    if( window.electronAPI ) return
    await get_browser_model_manager().clear()
}

/**
 * Downloads a GGUF model from Hugging Face with progress tracking.
 * Electron streams to the filesystem; browsers stream to OPFS and keep only
 * lightweight source metadata in IndexedDB.
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

    // Browser path: Wllama streams directly into OPFS. This avoids keeping a
    // second multi-GB copy in V8 while assembling a Blob.
    const downloaded = await get_browser_model_manager().downloadModel( url, {
        signal,
        progressCallback: ( { loaded, total } ) => {
            const bytes_total = total || model.file_size_bytes
            on_progress( {
                progress: bytes_total > 0 ? Math.min( loaded / bytes_total, 1 ) : 0,
                bytes_loaded: loaded,
                bytes_total,
                status: `Downloading...`,
            } )
        },
    } )

    const downloaded_files = await downloaded.open()
    const [ first_file ] = downloaded_files
    const downloaded_size = downloaded_files.reduce( ( total, file ) => total + file.size, 0 )
    const expected_size = model.file_size_bytes

    on_progress( {
        progress: 1,
        bytes_loaded: downloaded_size,
        bytes_total: expected_size || downloaded_size,
        status: `Validating model...`,
    } )

    if( !first_file ||  expected_size > 0 && downloaded_size !== expected_size  ) {
        log.warn( `[download] Size validation failed — expected ${ expected_size }, received ${ downloaded_size }` )
        await downloaded.remove()
        throw new Error( `The model download was incomplete. Please retry the download.` )
    }

    const header = new Uint8Array( await first_file.slice( 0, 4 ).arrayBuffer() )
    const is_valid_gguf = header[ 0 ] === 0x47 && header[ 1 ] === 0x47 && header[ 2 ] === 0x55 && header[ 3 ] === 0x46
    if( !is_valid_gguf ) {
        log.warn( `[download] GGUF validation failed — file may be corrupt` )
        await downloaded.remove()
        throw new Error( `Downloaded file is not a valid GGUF model. The file may be corrupted or the URL may have redirected to an error page.` )
    }

    const now = Date.now()
    const db = await get_db()
    await db.put( `models`, {
        id: model.id,
        storage: `wllama64-opfs`,
        download_url: url,
        cached_at: now,
        file_size_bytes: expected_size || downloaded_size,
        name: model.name,
        category: model.category,
        hugging_face_repo: model.hugging_face_repo,
        file_name: model.file_name,
        parameters_label: model.parameters_label,
        quantization: model.quantization,
        context_length: model.context_length,
        reasoning: model.reasoning,
        reasoning_enabled: model.reasoning_enabled,
        last_used_at: now,
    } )

    log.info( `[download] Complete: ${ model.name } (${ ( downloaded_size / 1e6 ).toFixed( 0 ) } MB)` )
    on_progress( { progress: 1, bytes_loaded: downloaded_size, bytes_total: downloaded_size, status: `Complete` } )

}
