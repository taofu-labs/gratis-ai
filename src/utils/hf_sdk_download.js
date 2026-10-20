import { downloadFile, fileDownloadInfo } from '@huggingface/hub'
import { log } from 'mentie'
import { write_stream_to_external_model_file } from './external_model_files'
import { get_hf_token } from './hf_auth'

const HF_BASE_URL = import.meta.env.VITE_HF_BASE_URL || `https://huggingface.co`
const RESUME_KEY_PREFIX = `partial_download:`

const clean_etag = value => String( value || `hf-sdk` ).replace( /[^A-Za-z0-9]/g, `` ) || `hf-sdk`

const abort_error = () => {
    try {
        return new DOMException( `Download aborted`, `AbortError` )
    } catch {
        return Object.assign( new Error( `Download aborted` ), { name: `AbortError` } )
    }
}

const with_abort_signal = ( fetch_impl, signal ) => ( input, init = {} ) =>
    fetch_impl( input, {
        ...init,
        ... signal ? { signal } : {} ,
    } )

/**
 * Wrap a stream so an abort errors the consumer immediately and cancels the
 * source. The SDK's Xet path pipes internal fetches that may not honor the
 * signal, so the write loop must never depend on the source stopping itself.
 * @param {ReadableStream} stream
 * @param {AbortSignal} [signal]
 * @returns {ReadableStream}
 */
export const abortable_stream = ( stream, signal ) => {

    if( !signal ) return stream

    const reader = stream.getReader()
    let on_abort = null
    const cleanup = () => signal.removeEventListener( `abort`, on_abort )

    return new ReadableStream( {

        start( controller ) {
            on_abort = () => {
                controller.error( abort_error() )
                reader.cancel( abort_error() ).catch( () => {} )
            }
            if( signal.aborted ) on_abort()
            else signal.addEventListener( `abort`, on_abort, { once: true } )
        },

        async pull( controller ) {
            if( signal.aborted ) return
            try {
                const { done, value } = await reader.read()
                if( signal.aborted ) return
                if( done ) {
                    cleanup()
                    controller.close()
                    return
                }
                controller.enqueue( value )
            } catch ( error ) {
                cleanup()
                if( !signal.aborted ) controller.error( error )
            }
        },

        cancel( reason ) {
            cleanup()
            return reader.cancel( reason )
        },

    } )

}

const create_progress_stream = ( total, on_progress, offset = 0 ) => {
    let loaded = offset
    let last_reported_at = 0

    return {
        stream: new TransformStream( {
            transform( chunk, controller ) {
                loaded += chunk.byteLength || 0
                const now = performance.now()
                if( now - last_reported_at > 100 ) {
                    last_reported_at = now
                    on_progress?.( { loaded, total } )
                }
                controller.enqueue( chunk )
            },
            flush() {
                on_progress?.( { loaded, total } )
            },
        } ),
        get_loaded: () => loaded,
    }
}

const get_hf_model_blob = async ( {
    model,
    signal,
    access_token = get_hf_token() || undefined,
    fetch_impl = fetch,
    sdk = { fileDownloadInfo, downloadFile },
} ) => {

    if( signal?.aborted ) throw abort_error()

    const fetch_with_signal = with_abort_signal( fetch_impl, signal )
    const auth = access_token ? { accessToken: access_token } : {}
    const params = {
        repo: model.hugging_face_repo,
        path: model.file_name,
        revision: `main`,
        hubUrl: HF_BASE_URL,
        fetch: fetch_with_signal,
        ...auth,
    }

    const info = await sdk.fileDownloadInfo( params )
    if( !info ) throw new Error( `Hugging Face could not find that model or GGUF file.` )

    const blob = await sdk.downloadFile( {
        ...params,
        downloadInfo: info,
        parallelDownloads: true,
    } )
    if( !blob?.stream ) throw new Error( `Hugging Face did not return a downloadable model file.` )

    return { blob, info }

}

const resume_record_key = cache_key => `${ RESUME_KEY_PREFIX }${ cache_key }`

const read_resume_record = ( storage, cache_key ) => {
    try {
        return JSON.parse( storage?.getItem( resume_record_key( cache_key ) ) || `null` )
    } catch {
        return null
    }
}

const write_resume_record = ( storage, cache_key, record ) => {
    try {
        if( record ) storage?.setItem( resume_record_key( cache_key ), JSON.stringify( record ) )
        else storage?.removeItem( resume_record_key( cache_key ) )
    } catch {
        // Private mode only loses resumability, never the download itself
    }
}

/**
 * Decide where a download may resume. Only a prefix written for the same
 * remote revision (etag + size) is trusted; anything else restarts at zero.
 *
 * @param {Object} options
 * @param {{ etag: string, total: number }|null} options.record - Persisted resume record
 * @param {number} options.stored_size - Current partial file size, -1 when missing
 * @param {string} options.etag - Remote etag
 * @param {number} options.total - Remote size
 * @returns {number} Byte offset to resume from
 */
export const get_resume_offset = ( { record, stored_size, etag, total } ) => {
    if( !record || !( total > 0 ) || !( stored_size > 0 ) ) return 0
    if( record.etag !== etag || record.total !== total ) return 0
    if( stored_size > total ) return 0
    return stored_size
}

/**
 * Delete interrupted downloads other than `keep_key`. Their prefixes have no
 * metadata, so no model list can show or delete them; they would only eat quota.
 * @param {Object} options
 * @param {{ delete: Function }} options.storage_backend
 * @param {string|null} [options.keep_key] - Cache key of the download that may resume
 * @param {Storage} [options.storage]
 * @returns {Promise<void>}
 */
export const sweep_partial_downloads = async ( { storage_backend, keep_key = null, storage = globalThis.localStorage } ) => {

    let keys = []
    try {
        keys = Array.from( { length: storage?.length || 0 }, ( _, index ) => storage.key( index ) )
            .filter( key => key?.startsWith( RESUME_KEY_PREFIX ) )
    } catch {
        return
    }

    for( const record_key of keys ) {
        const cache_key = record_key.slice( RESUME_KEY_PREFIX.length )
        if( cache_key === keep_key ) continue
        await storage_backend.delete( cache_key ).catch( () => {} )
        write_resume_record( storage, cache_key, null )
    }

}

/**
 * Download one GGUF through Hugging Face's browser SDK path and write it into
 * wllama64's OPFS cache. The SDK can use Xet metadata and adaptive parallel
 * reads anonymously; a token is only added when the user configured one.
 *
 * An interrupted download (reload, crash, network error) keeps its OPFS prefix
 * without wllama metadata, so it can never validate as a model. The next
 * attempt for the same etag/size resumes from a ranged slice of the SDK blob.
 * An abort deletes the prefix: cancel means discard.
 *
 * @param {Object} options
 * @param {import('./model_catalog').ModelDefinition} options.model
 * @param {string} options.url
 * @param {import('wllama64').CacheManager} options.cache_manager
 * @param {{ append: Function, getSize: Function, delete: Function }} options.storage_backend - Backend behind cache_manager
 * @param {Function} [options.on_progress]
 * @param {AbortSignal} [options.signal]
 * @param {string} [options.access_token]
 * @param {typeof fetch} [options.fetch_impl]
 * @param {{ fileDownloadInfo: typeof fileDownloadInfo, downloadFile: typeof downloadFile }} [options.sdk]
 * @param {Storage} [options.storage] - Persists resume records
 * @returns {Promise<{ cache_key: string, size: number, etag: string, mode: 'xet'|'web', resumed_from: number }>}
 */
export const download_hf_model_file_to_cache = async ( {
    model,
    url,
    cache_manager,
    storage_backend,
    on_progress,
    signal,
    access_token = get_hf_token() || undefined,
    fetch_impl = fetch,
    sdk = { fileDownloadInfo, downloadFile },
    storage = globalThis.localStorage,
} ) => {

    const { blob, info } = await get_hf_model_blob( { model, signal, access_token, fetch_impl, sdk } )

    const total = info.size || model.file_size_bytes || 0
    const etag = clean_etag( info.etag )
    const cache_key = await cache_manager.getNameFromURL( url )
    await sweep_partial_downloads( { storage_backend, keep_key: cache_key, storage } )

    // Existing metadata belongs to an older entry the caller already judged
    // invalid. Drop it so it cannot adopt the new bytes mid-download.
    const existing_metadata = await cache_manager.getMetadata( cache_key ).catch( () => null )
    if( existing_metadata?.originalURL ) {
        await cache_manager.delete( cache_key ).catch( () => {} )
        write_resume_record( storage, cache_key, null )
    }

    const stored_size = await storage_backend.getSize( cache_key ).catch( () => -1 )
    const offset = get_resume_offset( {
        record: read_resume_record( storage, cache_key ),
        stored_size,
        etag,
        total,
    } )
    if( offset > 0 ) log.info( `[download] Resuming ${ model.file_name } at ${ ( offset / 1e6 ).toFixed( 0 ) } MB` )

    write_resume_record( storage, cache_key, { etag, total, url } )
    on_progress?.( { loaded: offset, total, resumed_from: offset } )

    const discard_partial = async () => {
        await storage_backend.delete( cache_key ).catch( () => {} )
        write_resume_record( storage, cache_key, null )
    }

    const progress = create_progress_stream( total, on_progress, offset )
    let stored_bytes = offset

    try {

        // A prefix that already holds every byte only lacks its metadata
        if( !( total > 0 ) || offset < total ) {
            const source = offset > 0 ? blob.slice( offset ) : blob
            const stream = abortable_stream( source.stream(), signal ).pipeThrough( progress.stream )
            stored_bytes = await storage_backend.append( cache_key, stream, { offset } )
        }

        if( signal?.aborted ) throw abort_error()

    } catch ( error ) {
        // Cancel discards; transient failures keep the prefix for a resume
        if( signal?.aborted || error?.name === `AbortError` ) await discard_partial()
        throw error
    }

    if( total > 0 && stored_bytes !== total ) {
        await discard_partial()
        throw new Error( `The model download was incomplete. Please retry the download.` )
    }

    // Metadata last: only now does wllama see a model at this key
    await cache_manager.writeMetadata( cache_key, {
        originalURL: url,
        originalSize: total || stored_bytes,
        etag,
    } )
    write_resume_record( storage, cache_key, null )

    return {
        cache_key,
        size: stored_bytes || total,
        etag,
        mode: info.xet ? `xet` : `web`,
        resumed_from: offset,
    }

}

/**
 * Discard an interrupted OPFS download for `url`, if any.
 * @param {Object} options
 * @param {string} options.url
 * @param {import('wllama64').CacheManager} options.cache_manager
 * @param {{ delete: Function }} options.storage_backend
 * @param {Storage} [options.storage]
 * @returns {Promise<void>}
 */
export const discard_partial_download = async ( { url, cache_manager, storage_backend, storage = globalThis.localStorage } ) => {
    const cache_key = await cache_manager.getNameFromURL( url )
    if( !read_resume_record( storage, cache_key ) ) return
    await storage_backend.delete( cache_key ).catch( () => {} )
    write_resume_record( storage, cache_key, null )
}

/**
 * Download one GGUF through the HF SDK and write it to a user-picked file.
 * This path bypasses per-origin OPFS quota for large browser models.
 *
 * @param {Object} options
 * @param {import('./model_catalog').ModelDefinition} options.model
 * @param {FileSystemFileHandle} options.file_handle
 * @param {Function} [options.on_progress]
 * @param {AbortSignal} [options.signal]
 * @param {string} [options.access_token]
 * @param {typeof fetch} [options.fetch_impl]
 * @param {{ fileDownloadInfo: typeof fileDownloadInfo, downloadFile: typeof downloadFile }} [options.sdk]
 * @returns {Promise<{ size: number, etag: string, mode: 'xet'|'web' }>}
 */
export const download_hf_model_file_to_external_file = async ( {
    model,
    file_handle,
    on_progress,
    signal,
    access_token = get_hf_token() || undefined,
    fetch_impl = fetch,
    sdk = { fileDownloadInfo, downloadFile },
} ) => {

    const { blob, info } = await get_hf_model_blob( { model, signal, access_token, fetch_impl, sdk } )
    const total = info.size || model.file_size_bytes || 0
    const etag = clean_etag( info.etag )

    on_progress?.( { loaded: 0, total } )

    const size = await write_stream_to_external_model_file( file_handle, abortable_stream( blob.stream(), signal ), {
        expected_size: total,
        on_progress,
        signal,
    } )

    return {
        size: size || total,
        etag,
        mode: info.xet ? `xet` : `web`,
    }

}
