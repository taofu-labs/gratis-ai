import { log } from 'mentie'
import { CacheManager, ModelManager, ModelValidationStatus } from 'wllama64'
import { get_db } from '../stores/db'
import { get_external_model_file, take_pending_external_model_file } from './external_model_files'
import { get_hf_headers, normalize_hf_error } from './hf_auth'
import {
    discard_partial_download,
    download_hf_model_file_to_cache,
    download_hf_model_file_to_external_file,
    sweep_partial_downloads,
} from './hf_sdk_download'
import { build_download_url } from './hf_url_parser'
import { get_model_by_id, model_download_bytes } from './model_catalog'
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

/**
 * Where a model's vision projector comes from, or null for text-only models.
 * The repo defaults to the language model's own repo.
 * @param {import('./model_catalog').ModelDefinition} model
 * @returns {{ hugging_face_repo: string, file_name: string, file_size_bytes: number, url: string }|null}
 */
export const projector_source = model => {

    if( !model?.mmproj?.file_name ) return null

    const hugging_face_repo = model.mmproj.hugging_face_repo || model.hugging_face_repo
    const { file_name, file_size_bytes } = model.mmproj
    return { hugging_face_repo, file_name, file_size_bytes, url: build_download_url( hugging_face_repo, file_name ) }

}

/**
 * Validated OPFS projector for a model, or null when it is not installed.
 * @param {import('./model_catalog').ModelDefinition} model
 * @returns {Promise<import('wllama64').Model|null>}
 */
export const get_browser_cached_projector = async model => {
    const projector = projector_source( model )
    if( !projector ) return null
    return get_browser_cached_model( projector.url, projector.file_size_bytes )
}

/** Remove one OPFS entry by URL; failures only cost quota. */
const remove_opfs_url = async url => {
    try {
        const models = await get_browser_model_manager().getModels( { includeInvalid: true } )
        const stored_model = models.find( model => model.url === url )
        if( stored_model ) await stored_model.remove()
    } catch ( error ) {
        // Metadata must still be cleared when OPFS itself is unavailable.
        log.warn( `[download] Could not remove OPFS cache entry:`, error )
    }
}

const remove_browser_cache_entry = async ( cached ) => {

    if( cached?.download_url && !cached?.file_handle ) await remove_opfs_url( cached.download_url )

    // The projector always lives in OPFS, even beside an external model file
    const projector = projector_source( get_model_by_id( cached?.id ) || cached )
    if( projector ) await remove_opfs_url( projector.url )

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
    vision: model.vision,
    mmproj: model.mmproj,
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
 * Whether a model's vision projector is installed. True for text-only models,
 * so "complete install" reads as `is_model_cached && is_projector_cached`.
 * @param {import('./model_catalog').ModelDefinition} model
 * @returns {Promise<boolean>}
 */
export const is_projector_cached = async ( model ) => {

    if( !projector_source( model ) ) return true

    // Electron's manifest records the projector beside the model
    if( window.electronAPI?.list_models ) {
        const models = await window.electronAPI.list_models()
        return !!models.find( ( { id } ) => id === model.id )?.mmproj_file_name
    }

    const stored = await get_browser_cached_projector( model ).catch( () => null )
    return !!stored

}

/**
 * Discard a model's interrupted OPFS download so an explicit cancel never
 * resumes later. No-op in Electron and when no partial download exists.
 * An install only counts once its metadata exists, so finished parts of an
 * unregistered install (model done, projector not) are removed as well.
 * @param {Object} model - Model definition
 * @returns {Promise<void>}
 */
export const discard_browser_partial_download = async ( model ) => {

    if( window.electronAPI ) return

    const { cacheManager: cache_manager } = get_browser_model_manager()
    const urls = [
        build_download_url( model.hugging_face_repo, model.file_name ),
        projector_source( model )?.url,
    ].filter( Boolean )

    await Promise.all( urls.map( url => discard_partial_download( { url, cache_manager, storage_backend: browser_storage_backend } ) ) )

    // Never touch files an installed model (this or another) still uses
    const db = await get_db()
    if( await db.get( `models`, model.id ) ) return
    const in_use = new Set( ( await db.getAll( `models` ) ).map( ( { download_url } ) => download_url ) )
    await Promise.all( urls.filter( url => !in_use.has( url ) ).map( remove_opfs_url ) )

}

const GGUF_MAGIC = [ 0x47, 0x47, 0x55, 0x46 ]

/**
 * Check a downloaded GGUF's size and magic bytes. Throws a user-facing error.
 * @param {Blob[]} files - Shards as returned by `Model.open()`
 * @param {number} expected_size
 * @returns {Promise<number>} Stored size
 */
const validate_gguf_files = async ( files, expected_size ) => {

    const [ first_file ] = files
    const size = files.reduce( ( total, file ) => total + file.size, 0 )

    if( !first_file || expected_size > 0 && size !== expected_size ) {
        log.warn( `[download] Size validation failed — expected ${ expected_size }, received ${ size }` )
        throw new Error( `The model download was incomplete. Please retry the download.` )
    }

    const header = new Uint8Array( await first_file.slice( 0, 4 ).arrayBuffer() )
    if( !GGUF_MAGIC.every( ( byte, index ) => header[ index ] === byte ) ) {
        log.warn( `[download] GGUF validation failed — file may be corrupt` )
        throw new Error( `Downloaded file is not a valid GGUF model. The file may be corrupted or the URL may have redirected to an error page.` )
    }

    return size

}

/**
 * Put one GGUF into OPFS unless a validated copy is already there.
 * @param {Object} options
 * @param {{ hugging_face_repo: string, file_name: string, file_size_bytes: number, url: string }} options.part
 * @param {AbortSignal} [options.signal]
 * @param {Function} options.on_progress - ({ loaded, resumed_from })
 * @returns {Promise<{ stored: import('wllama64').Model, fresh: boolean }>}
 */
const download_part_to_opfs = async ( { part, signal, on_progress } ) => {

    // Retrying an install fetches only the part that is still missing
    const existing = await get_browser_cached_model( part.url, part.file_size_bytes )
    if( existing ) {
        on_progress( { loaded: part.file_size_bytes } )
        return { stored: existing, fresh: false }
    }

    const result = await download_hf_model_file_to_cache( {
        model: part,
        url: part.url,
        cache_manager: get_browser_model_manager().cacheManager,
        storage_backend: browser_storage_backend,
        signal,
        on_progress,
    } )

    log.debug( `[download] ${ part.file_name } used the ${ result.mode } path into OPFS (resumed from ${ result.resumed_from } bytes)` )
    const stored = await get_browser_cached_model( part.url, result.size || part.file_size_bytes )
    if( !stored ) throw new Error( `The downloaded model could not be validated. Please retry the download.` )
    return { stored, fresh: true }

}

/**
 * Downloads a GGUF model, plus its vision projector when the catalog lists
 * one, from Hugging Face with one progress bar over both files.
 * Electron streams to the filesystem; browsers stream to OPFS and keep only
 * lightweight source metadata in IndexedDB. The metadata is written once
 * every part is validated, so a half-finished install never counts.
 *
 * @param {Object} model - Model definition (see ModelDefinition)
 * @param {Function} on_progress - Progress callback ({ progress, bytes_loaded, bytes_total, status })
 * @param {AbortSignal} [signal] - Abort signal for cancellation
 * @param {Object} [options]
 * @param {'opfs'|'external-file'} [options.storage_mode]
 * @returns {Promise<void>}
 */
export const download_model = async ( model, on_progress, signal, { storage_mode } = {} ) => {

    const url = build_download_url( model.hugging_face_repo, model.file_name )
    const projector = projector_source( model )
    const bytes_total = model_download_bytes( model )
    const headers = get_hf_headers()
    const speed_tracker = create_download_speed_tracker( url )
    const report_progress = progress => {
        speed_tracker.update( progress )
        on_progress( progress )
    }

    log.info( `[download] Starting: ${ model.name } (${ ( bytes_total / 1e6 ).toFixed( 0 ) } MB${ projector ? `, with vision projector` : `` })` )

    report_progress( { progress: 0, bytes_loaded: 0, bytes_total, status: `Starting download...` } )

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

                // Vision projector — main downloads it alongside the model (summed progress)
                ... model.mmproj ? { mmproj: {
                    url: build_download_url( model.mmproj.hugging_face_repo || model.hugging_face_repo, model.mmproj.file_name ),
                    file_name: model.mmproj.file_name,
                    expected_size: model.mmproj.file_size_bytes,
                } } : {},
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

    // Browser path: one bar over model then projector. Each part reports its
    // own bytes; `offset` places them on the shared total.
    const progress_from = offset => ( { loaded, total, resumed_from } ) => {
        const bytes_loaded = offset + loaded
        const shared_total = Math.max( bytes_total, offset + ( total || 0 ) )
        report_progress( {
            progress: shared_total > 0 ? Math.min( bytes_loaded / shared_total, 1 ) : 0,
            bytes_loaded,
            bytes_total: shared_total,
            ... resumed_from > 0 ? { resumed_from: offset + resumed_from } : {},
            status: `Downloading...`,
        } )
    }

    const db = await get_db()
    const existing_entry = await db.get( `models`, model.id )

    // URLs this call wrote into OPFS; a cancel removes exactly these
    const fresh_urls = []
    const throw_if_aborted = async () => {
        if( !signal?.aborted ) return
        await Promise.all( fresh_urls.map( remove_opfs_url ) )
        throw abort_error()
    }

    // ── Language model ───────────────────────────────────────────────

    let model_files
    let entry_storage
    try {
        if( storage_mode === `external-file` ) {

            // Adding a projector to an installed model reuses the user's file
            const reusable = existing_entry?.file_handle
                && await get_external_model_file( existing_entry.file_handle, model.file_size_bytes ).catch( () => null )
            const file_handle = reusable ? existing_entry.file_handle : take_pending_external_model_file( model.id )
            if( !file_handle ) throw new Error( `Choose where to save this GGUF file before downloading.` )

            if( reusable ) progress_from( 0 )( { loaded: model.file_size_bytes } )
            else {
                const result = await download_hf_model_file_to_external_file( {
                    model,
                    file_handle,
                    signal,
                    on_progress: progress_from( 0 ),
                } )
                log.debug( `[download] Hugging Face SDK browser download used ${ result.mode } path into external file` )
            }

            model_files = [ reusable || await get_external_model_file( file_handle, model.file_size_bytes ) ]
            entry_storage = { storage: `file-system-access`, file_handle, download_url: url }

        } else {

            const { stored, fresh } = await download_part_to_opfs( {
                part: { ...model, url },
                signal,
                on_progress: progress_from( 0 ),
            } )
            if( fresh ) fresh_urls.push( url )
            model_files = await stored.open()
            entry_storage = { storage: `wllama64-opfs`, download_url: url }

        }
    } catch ( err ) {
        if( err?.name === `AbortError` || signal?.aborted ) await throw_if_aborted()
        throw normalize_hf_error( err )
    }

    await throw_if_aborted()
    report_progress( { progress: bytes_total > 0 ? model.file_size_bytes / bytes_total : 1, bytes_loaded: model.file_size_bytes, bytes_total, status: `Validating model...` } )

    let downloaded_size
    try {
        downloaded_size = await validate_gguf_files( model_files, model.file_size_bytes )
    } catch ( error ) {
        if( storage_mode !== `external-file` ) await remove_opfs_url( url )
        throw error
    }

    // ── Vision projector (always OPFS) ───────────────────────────────

    if( projector ) {

        let projector_files
        try {
            const { stored, fresh } = await download_part_to_opfs( {
                part: projector,
                signal,
                on_progress: progress_from( model.file_size_bytes ),
            } )
            if( fresh ) fresh_urls.push( projector.url )
            projector_files = await stored.open()
        } catch ( err ) {
            if( err?.name === `AbortError` || signal?.aborted ) await throw_if_aborted()
            throw normalize_hf_error( err )
        }

        await throw_if_aborted()

        try {
            downloaded_size += await validate_gguf_files( projector_files, projector.file_size_bytes )
        } catch ( error ) {
            await remove_opfs_url( projector.url )
            throw error
        }

    }

    await throw_if_aborted()

    const now = Date.now()
    await db.put( `models`, cache_metadata( model, {
        ...entry_storage,
        cached_at: existing_entry?.cached_at || now,
        file_size_bytes: model.file_size_bytes || model_files[ 0 ].size,
        last_used_at: now,
    } ) )

    log.info( `[download] Complete: ${ model.name } (${ ( downloaded_size / 1e6 ).toFixed( 0 ) } MB)` )
    report_progress( { progress: 1, bytes_loaded: downloaded_size, bytes_total: downloaded_size, status: `Complete` } )

}
