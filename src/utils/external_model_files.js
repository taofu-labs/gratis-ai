// Keep a margin under the origin quota: OPFS writes fail outright once it is hit
const QUOTA_HEADROOM = 1.1

const pending_file_handles = new Map()

const abort_error = () => {
    try {
        return new DOMException( `Download aborted`, `AbortError` )
    } catch {
        return Object.assign( new Error( `Download aborted` ), { name: `AbortError` } )
    }
}

export const supports_external_model_files = () =>
    typeof window !== `undefined`
    && !window.electronAPI?.download_model
    && typeof window.showSaveFilePicker === `function`

/**
 * Free space this origin may still use in browser storage (OPFS)
 * @returns {Promise<number>} Bytes, or Infinity when the browser won't say
 */
export const browser_storage_free_bytes = async () => {
    try {
        const { quota, usage = 0 } = await navigator.storage.estimate()
        return quota ? quota - usage : Infinity
    } catch {
        return Infinity
    }
}

/**
 * Ask the browser not to evict downloaded models under storage pressure.
 * Best effort: Chromium decides silently, Firefox may ask once.
 */
export const request_persistent_storage = async () => {
    try {
        if( !await navigator.storage.persisted() ) await navigator.storage.persist()
    } catch { /* unsupported: storage stays best-effort */ }
}

/**
 * Browser storage is the default; a user-picked file is the fallback only when
 * the download won't fit in this origin's remaining quota
 * @param {Object} model - Catalog entry
 * @param {number} download_bytes - Model plus projector
 * @param {number} free_bytes - From `browser_storage_free_bytes`
 * @returns {boolean}
 */
export const should_use_external_model_file = ( model, download_bytes, free_bytes ) =>
    supports_external_model_files()
    && download_bytes * QUOTA_HEADROOM > free_bytes

export const choose_external_model_file = async model => {
    const handle = await window.showSaveFilePicker( {
        suggestedName: model.file_name || `${ model.id || `model` }.gguf`,
        types: [ {
            description: `GGUF model`,
            accept: { 'application/octet-stream': [ `.gguf` ] },
        } ],
    } )

    pending_file_handles.set( model.id, handle )
    return handle
}

export const take_pending_external_model_file = model_id => {
    const handle = pending_file_handles.get( model_id )
    pending_file_handles.delete( model_id )
    return handle
}

export const request_external_model_file_permission = async ( handle, mode = `read` ) => {
    if( !handle?.queryPermission ) return true

    const options = { mode }
    if( await handle.queryPermission( options ) === `granted` ) return true
    if( !handle.requestPermission ) return false

    return await handle.requestPermission( options ) === `granted`
}

export const get_external_model_file = async ( handle, expected_size ) => {
    if( !await request_external_model_file_permission( handle ) ) {
        throw new Error( `Grant access to the local GGUF file to load this model.` )
    }

    const file = await handle.getFile()
    if( expected_size > 0 && file.size !== expected_size ) {
        throw new Error( `The selected GGUF file changed or is incomplete. Download it again.` )
    }

    return file
}

export const write_stream_to_external_model_file = async ( handle, stream, {
    expected_size = 0,
    on_progress,
    signal,
} = {} ) => {

    if( signal?.aborted ) throw abort_error()

    const writable = await handle.createWritable( { keepExistingData: false } )
    const reader = stream.getReader()
    let loaded = 0

    try {
        while( true ) {
            if( signal?.aborted ) throw abort_error()

            const { done, value } = await reader.read()
            if( done ) break
            if( !value?.byteLength ) continue

            await writable.write( value )
            loaded += value.byteLength
            on_progress?.( { loaded, total: expected_size } )
        }

        await writable.close()
    } catch ( error ) {
        await writable.abort().catch( () => {} )
        await reader.cancel( error ).catch( () => {} )
        throw error
    } finally {
        reader.releaseLock()
    }

    if( expected_size > 0 && loaded !== expected_size ) {
        throw new Error( `The model download was incomplete. Please retry the download.` )
    }

    return loaded

}
