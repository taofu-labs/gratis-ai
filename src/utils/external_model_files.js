export const EXTERNAL_MODEL_FILE_THRESHOLD_BYTES = 2_000_000_000

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

export const should_use_external_model_file = model =>
    supports_external_model_files()
    && Number( model?.file_size_bytes ) > EXTERNAL_MODEL_FILE_THRESHOLD_BYTES

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
