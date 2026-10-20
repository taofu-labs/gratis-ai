import { log } from 'mentie'
import { CacheManager, ModelManager, ModelValidationStatus } from 'wllama64'
import { get_db } from '../stores/db'
import { get_external_model_file, take_pending_external_model_file } from './external_model_files'
import { get_hf_headers, normalize_hf_error } from './hf_auth'
import {
    download_hf_model_file_to_cache,
    download_hf_model_file_to_external_file,
    sweep_partial_downloads,
} from './hf_sdk_download'
import { build_download_url } from './hf_url_parser'
import { get_model_by_id } from './model_catalog'
import { create_download_speed_tracker } from './network_speed'
import { ReliableOPFSBackend } from './reliable_opfs_backend'

const WLLAMA_CACHE_LOGGER = {
    debug: ( ...args ) => log.debug( `[model-cache]`, ...args ),
    log: ( ...args ) => log.info( `[model-cache]`, ...args ),
    warn: ( ...args ) => log.warn( `[model-cache]`, ...args ),
    error: ( ...args ) => log.error( `[model-cache]`, ...args ),
}

let browser_model_manager = null

// One backend instance shared by wllama's CacheManager and resumable downloads
const browser_storage_backend = new ReliableOPFSBackend()

const abort_error = () => Object.assign( new Error( `Download aborted` ), { name: `AbortError` } )

/**
 * Get the shared browser model manager backed by OPFS.
 * @returns {ModelManager}
 */
export const get_browser_model_manager = () => {
    if( !browser_model_manager ) {
        browser_model_manager = new ModelManager( {
            allowOffline: true,
            cacheManager: new CacheManager( [ browser_storage_backend ] ),
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

    if( cached?.download_url && !cached?.file_handle ) {
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

const cache_metadata = ( model, overrides = {} ) => ( {
    id: model.id,
    name: model.name,
    category: model.category,
    family: model.family,
    parameters: model.parameters,
    parameters_label: model.parameters_label,
    quantization: model.quantization,
    bpw: model.bpw,
    file_size_bytes: model.file_size_bytes,
    context_length: model.context_length,
    layers: model.layers,
    block_count: model.block_count,
    kv_heads: model.kv_heads,
    head_dim: model.head_dim,
    hugging_face_repo: model.hugging_face_repo,
    file_name: model.file_name,
    reasoning: model.reasoning,
    reasoning_enabled: model.reasoning_enabled,
    license: model.license,
    is_custom: model.is_custom,
    is_tpn_winner: model.is_tpn_winner,
    tpn_competition: model.tpn_competition,
    tpn_author: model.tpn_author,
    tpn_collection_url: model.tpn_collection_url,
    ...overrides,
} )

/**
 * Builds the Hugging Face download URL for a model
 * @param {string} repo - Hugging Face repo (e.g., "TheBloke/model-GGUF")
 * @param {string} file_name - GGUF file name
 * @returns {string} Full download URL
 */
export { build_download_url } from './hf_url_parser'

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

    if( cached.file_handle ) {
        try {
            await get_external_model_file( cached.file_handle, cached.file_size_bytes )
            log.debug( `[download] Cache hit: ${ model_id } (external file)` )
            return true
        } catch ( error ) {
            log.warn( `[download] External file unavailable for ${ model_id }:`, error )
            return false
        }
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
    await sweep_partial_downloads( { storage_backend: browser_storage_backend } )
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
export const download_model = async ( model, on_progress, signal, { storage_mode } = {} ) => {

    const url = build_download_url( model.hugging_face_repo, model.file_name )
    const headers = get_hf_headers()
    const speed_tracker = create_download_speed_tracker( url )
    const report_progress = progress => {
        speed_tracker.update( progress )
        on_progress( progress )
    }

    const size_mb = ( model.file_size_bytes / 1e6 ).toFixed( 0 )
    log.info( `[download] Starting: ${ model.name } (${ size_mb } MB)` )

    report_progress( { progress: 0, bytes_loaded: 0, bytes_total: model.file_size_bytes, status: `Starting download...` } )

    // In Electron, delegate to the main process which streams directly to disk.
    // This avoids buffering multi-GB files in the renderer's V8 heap.
    if( window.electronAPI?.download_model ) {

        log.debug( `[download] Using Electron IPC download` )

        // Forward progress events from main process
        const cleanup = window.electronAPI.on_download_progress( report_progress )

        // Wire up abort signal to main process
        const abort_handler = () => window.electronAPI.abort_download()
        if( signal ) signal.addEventListener( `abort`, abort_handler )

        try {
            await window.electronAPI.download_model( {
                url,
                id: model.id,
                file_name: model.file_name,
                expected_size: model.file_size_bytes,
                headers,
                metadata: cache_metadata( model ),
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

    // Browser path: Hugging Face SDK resolves the best download path first,
    // including Xet parallel reads when available, then streams into OPFS.
    let downloaded
    let external_file_handle = null
    try {
        if( storage_mode === `external-file` ) {
            const file_handle = take_pending_external_model_file( model.id )
            if( !file_handle ) throw new Error( `Choose where to save this GGUF file before downloading.` )
            external_file_handle = file_handle

            const result = await download_hf_model_file_to_external_file( {
                model,
                file_handle,
                signal,
                on_progress: ( { loaded, total } ) => {
                    const bytes_total = total || model.file_size_bytes
                    report_progress( {
                        progress: bytes_total > 0 ? Math.min( loaded / bytes_total, 1 ) : 0,
                        bytes_loaded: loaded,
                        bytes_total,
                        status: `Downloading...`,
                    } )
                },
            } )

            log.debug( `[download] Hugging Face SDK browser download used ${ result.mode } path into external file` )

            const file = await get_external_model_file( file_handle, result.size || model.file_size_bytes )
            downloaded = {
                open: async () => [ file ],
                remove: async () => {},
            }
        }

        const manager = get_browser_model_manager()
        if( !downloaded ) {
            const result = await download_hf_model_file_to_cache( {
                model,
                url,
                cache_manager: manager.cacheManager,
                storage_backend: browser_storage_backend,
                signal,
                on_progress: ( { loaded, total, resumed_from } ) => {
                    const bytes_total = total || model.file_size_bytes
                    report_progress( {
                        progress: bytes_total > 0 ? Math.min( loaded / bytes_total, 1 ) : 0,
                        bytes_loaded: loaded,
                        bytes_total,
                        ... resumed_from > 0 ? { resumed_from } : {},
                        status: `Downloading...`,
                    } )
                },
            } )

            log.debug( `[download] Hugging Face SDK browser download used ${ result.mode } path into OPFS (resumed from ${ result.resumed_from } bytes)` )
            downloaded = await get_browser_cached_model( url, result.size || model.file_size_bytes )
            if( !downloaded ) throw new Error( `The downloaded model could not be validated. Please retry the download.` )
        }
    } catch ( err ) {
        if( err?.name === `AbortError` || signal?.aborted ) throw abort_error()
        throw normalize_hf_error( err )
    }

    // A cancel that lands after the last byte must still leave nothing behind
    const discard_if_aborted = async () => {
        if( !signal?.aborted ) return
        if( storage_mode !== `external-file` ) await downloaded.remove().catch( () => {} )
        throw abort_error()
    }
    await discard_if_aborted()

    const downloaded_files = await downloaded.open()
    const [ first_file ] = downloaded_files
    const downloaded_size = downloaded_files.reduce( ( total, file ) => total + file.size, 0 )
    const expected_size = model.file_size_bytes

    report_progress( {
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

    await discard_if_aborted()

    if( storage_mode === `external-file` ) {
        const now = Date.now()
        const db = await get_db()
        await db.put( `models`, cache_metadata( model, {
            storage: `file-system-access`,
            file_handle: external_file_handle,
            download_url: url,
            cached_at: now,
            file_size_bytes: expected_size || downloaded_size,
            last_used_at: now,
        } ) )
        log.info( `[download] Complete: ${ model.name } (${ ( downloaded_size / 1e6 ).toFixed( 0 ) } MB)` )
        report_progress( { progress: 1, bytes_loaded: downloaded_size, bytes_total: downloaded_size, status: `Complete` } )
        return
    }

    const now = Date.now()
    const db = await get_db()
    await db.put( `models`, cache_metadata( model, {
        storage: `wllama64-opfs`,
        download_url: url,
        cached_at: now,
        file_size_bytes: expected_size || downloaded_size,
        last_used_at: now,
    } ) )

    log.info( `[download] Complete: ${ model.name } (${ ( downloaded_size / 1e6 ).toFixed( 0 ) } MB)` )
    report_progress( { progress: 1, bytes_loaded: downloaded_size, bytes_total: downloaded_size, status: `Complete` } )

}
