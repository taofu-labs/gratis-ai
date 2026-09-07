import { downloadFile, fileDownloadInfo } from '@huggingface/hub'
import { write_stream_to_external_model_file } from './external_model_files'
import { get_hf_token } from './hf_auth'

const HF_BASE_URL = import.meta.env.VITE_HF_BASE_URL || `https://huggingface.co`

const clean_etag = value => String( value || `hf-sdk` ).replace( /[^A-Za-z0-9]/g, `` ) || `hf-sdk`

const with_abort_signal = ( fetch_impl, signal ) => ( input, init = {} ) =>
    fetch_impl( input, {
        ...init,
        ... signal ? { signal } : {} ,
    } )

const create_progress_stream = ( total, on_progress ) => {
    let loaded = 0
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

    if( signal?.aborted ) throw Object.assign( new Error( `Download aborted` ), { name: `AbortError` } )

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

/**
 * Download one GGUF through Hugging Face's browser SDK path and write it into
 * wllama64's OPFS cache. The SDK can use Xet metadata and adaptive parallel
 * reads anonymously; a token is only added when the user configured one.
 *
 * @param {Object} options
 * @param {import('./model_catalog').ModelDefinition} options.model
 * @param {string} options.url
 * @param {import('wllama64').CacheManager} options.cache_manager
 * @param {Function} [options.on_progress]
 * @param {AbortSignal} [options.signal]
 * @param {string} [options.access_token]
 * @param {typeof fetch} [options.fetch_impl]
 * @param {{ fileDownloadInfo: typeof fileDownloadInfo, downloadFile: typeof downloadFile }} [options.sdk]
 * @returns {Promise<{ cache_key: string, size: number, etag: string, mode: 'xet'|'web' }>}
 */
export const download_hf_model_file_to_cache = async ( {
    model,
    url,
    cache_manager,
    on_progress,
    signal,
    access_token = get_hf_token() || undefined,
    fetch_impl = fetch,
    sdk = { fileDownloadInfo, downloadFile },
} ) => {

    const { blob, info } = await get_hf_model_blob( { model, signal, access_token, fetch_impl, sdk } )

    const total = info.size || model.file_size_bytes || 0
    on_progress?.( { loaded: 0, total } )

    const etag = clean_etag( info.etag )
    const cache_key = await cache_manager.getNameFromURL( url )
    const progress = create_progress_stream( total, on_progress )

    await cache_manager.write( cache_key, blob.stream().pipeThrough( progress.stream ), {
        originalURL: url,
        originalSize: total,
        etag,
    } )

    const downloaded_size = progress.get_loaded()
    if( total > 0 && downloaded_size !== total ) {
        await cache_manager.delete( cache_key ).catch( () => {} )
        throw new Error( `The model download was incomplete. Please retry the download.` )
    }

    return {
        cache_key,
        size: downloaded_size || total,
        etag,
        mode: info.xet ? `xet` : `web`,
    }

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

    const size = await write_stream_to_external_model_file( file_handle, blob.stream(), {
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
