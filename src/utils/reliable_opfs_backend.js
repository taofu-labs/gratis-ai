/**
 * OPFS storage backend that treats a short synchronous write as normal I/O.
 *
 * wllama64 1.0.0 ignores FileSystemSyncAccessHandle.write()'s return value.
 * The File System API permits partial writes, so large downloads can otherwise
 * lose the tail of a chunk without surfacing an error. Keep this backend local
 * until the package handles short writes itself.
 */

const WORKER_SOURCE = `
    let access_handle = null
    let file_offset = 0

    const close_handle = () => {
        if( !access_handle ) return
        try { access_handle.close() } catch {}
        access_handle = null
    }

    const open_file = async ( filename ) => {
        const root = await navigator.storage.getDirectory()
        const cache = await root.getDirectoryHandle( 'cache', { create: true } )
        const file = await cache.getFileHandle( filename, { create: true } )

        access_handle = await file.createSyncAccessHandle()
        access_handle.truncate( 0 )
        file_offset = 0
    }

    const write_all = ( buffer ) => {
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array( buffer )
        let chunk_offset = 0

        while( chunk_offset < bytes.byteLength ) {
            const written = access_handle.write( bytes.subarray( chunk_offset ), { at: file_offset } )
            if( !Number.isSafeInteger( written ) || written <= 0 ) {
                throw new Error( 'OPFS returned a zero-length or invalid write' )
            }
            chunk_offset += written
            file_offset += written
        }
    }

    const finish_file = () => {
        access_handle.flush()
        const stored_size = access_handle.getSize()
        if( stored_size !== file_offset ) {
            throw new Error( 'OPFS size mismatch: wrote ' + file_offset + ', stored ' + stored_size )
        }
        close_handle()
        return stored_size
    }

    self.onmessage = async ( event ) => {
        const { id, action, filename, buffer } = event.data

        try {
            let value = null
            if( action === 'open' ) await open_file( filename )
            else if( action === 'write' ) write_all( buffer )
            else if( action === 'close' ) value = finish_file()
            else if( action === 'abort' ) close_handle()
            else throw new Error( 'Unknown OPFS action: ' + action )

            self.postMessage( { id, ok: true, value } )
        } catch( error ) {
            close_handle()
            self.postMessage( {
                id,
                ok: false,
                error: error && error.message ? error.message : String( error ),
            } )
        }
    }
`

const get_cache_directory = async () => {
    const root = await navigator.storage.getDirectory()
    return root.getDirectoryHandle( `cache`, { create: true } )
}

const create_writer = () => {
    const source = new Blob( [ WORKER_SOURCE ], { type: `text/javascript` } )
    const url = URL.createObjectURL( source )
    const worker = new Worker( url )
    URL.revokeObjectURL( url )

    let next_id = 0
    let worker_error = null
    const pending = new Map()

    worker.onmessage = ( { data } ) => {
        const request = pending.get( data.id )
        if( !request ) return
        pending.delete( data.id )
        if( data.ok ) request.resolve( data.value )
        else request.reject( new Error( data.error || `OPFS worker failed` ) )
    }

    worker.onerror = ( event ) => {
        worker_error = new Error( event.message || `OPFS worker crashed` )
        for( const request of pending.values() ) request.reject( worker_error )
        pending.clear()
    }

    return {
        call: ( action, detail = {} ) => new Promise( ( resolve, reject ) => {
            if( worker_error ) {
                reject( worker_error )
                return
            }

            const id = ++next_id
            pending.set( id, { resolve, reject } )
            const message = { id, action, ...detail }
            const transfer = detail.buffer?.buffer ? [ detail.buffer.buffer ] : []
            worker.postMessage( message, transfer )
        } ),
        terminate: () => worker.terminate(),
    }
}

/** Reliable wllama64 CacheManager backend using the origin-private cache directory. */
export class ReliableOPFSBackend {

    isSupported() {
        return typeof navigator !== `undefined`
            && typeof Worker !== `undefined`
            && !!navigator.storage?.getDirectory
    }

    async read( key ) {
        try {
            const directory = await get_cache_directory()
            const handle = await directory.getFileHandle( key )
            return handle.getFile()
        } catch ( error ) {
            if( error?.name === `NotFoundError` ) return null
            throw error
        }
    }

    async write( key, stream ) {
        const writer = create_writer()
        const reader = stream.getReader()
        let written_bytes = 0

        try {
            await writer.call( `open`, { filename: key } )

            while( true ) {
                const { done, value } = await reader.read()
                if( done ) break
                written_bytes += value.byteLength
                await writer.call( `write`, { buffer: value } )
            }

            const stored_bytes = await writer.call( `close` )
            if( stored_bytes !== written_bytes ) {
                throw new Error( `OPFS size mismatch: wrote ${ written_bytes }, stored ${ stored_bytes }` )
            }
        } catch ( error ) {
            await writer.call( `abort` ).catch( () => {} )
            await reader.cancel( error ).catch( () => {} )
            await this.delete( key ).catch( () => {} )
            throw error
        } finally {
            reader.releaseLock()
            writer.terminate()
        }
    }

    async getSize( key ) {
        const file = await this.read( key )
        return file?.size ?? -1
    }

    async list() {
        const directory = await get_cache_directory()
        const entries = []

        for await ( const [ key, handle ] of directory.entries() ) {
            if( handle.kind !== `file` ) continue
            const file = await handle.getFile()
            entries.push( { key, size: file.size } )
        }

        return entries
    }

    async delete( key ) {
        try {
            const directory = await get_cache_directory()
            await directory.removeEntry( key )
        } catch ( error ) {
            if( error?.name !== `NotFoundError` ) throw error
        }
    }

}
