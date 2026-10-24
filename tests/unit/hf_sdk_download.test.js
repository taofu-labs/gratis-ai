import { describe, expect, test, vi } from 'vitest'
import {
    abortable_stream,
    can_use_xet,
    discard_partial_download,
    download_hf_model_file_to_cache,
    download_hf_model_file_to_external_file,
    get_resume_offset,
    sweep_partial_downloads,
} from '../../src/utils/hf_sdk_download'

const model = {
    hugging_face_repo: `tpnlabs/test-model`,
    file_name: `test-model-Q4_K_M.gguf`,
    file_size_bytes: 6,
}

const download_url = `https://huggingface.co/tpnlabs/test-model/resolve/main/test-model-Q4_K_M.gguf`
const resume_key = `partial_download:cache-key`
const stale_key = `partial_download:stale-key`
const stale_record = JSON.stringify( { etag: `old`, total: 9, url: `https://x/old.gguf` } )

// Hold a download lock the way another tab's active download would
const hold_lock = name => {
    let release = null
    let acquired = null
    const ready = new Promise( resolve => acquired = resolve )
    navigator.locks.request( name, () => {
        acquired()
        return new Promise( resolve => release = resolve )
    } )
    return ready.then( () => release )
}

class MemoryStorage {
    constructor() {
        this.values = new Map()
    }
    getItem( key ) {
        return this.values.get( key ) ?? null
    }
    setItem( key, value ) {
        this.values.set( key, value )
    }
    removeItem( key ) {
        this.values.delete( key )
    }
    key( index ) {
        return [ ...this.values.keys() ][ index ] ?? null
    }
    get length() {
        return this.values.size
    }
}

const create_cache_manager = ( metadata = null ) => {
    const metadata_writes = []
    return {
        metadata_writes,
        getNameFromURL: vi.fn( async () => `cache-key` ),
        getMetadata: vi.fn( async () => metadata ),
        writeMetadata: vi.fn( async ( key, value ) => metadata_writes.push( { key, metadata: value } ) ),
        delete: vi.fn( async () => {} ),
    }
}

// In-memory stand-in for ReliableOPFSBackend: append keeps the prefix before `offset`
const create_backend = ( initial_size = -1 ) => {
    const backend = {
        size: initial_size,
        appends: [],
        getSize: vi.fn( async () => backend.size ),
        append: vi.fn( async ( key, stream, { offset = 0 } = {} ) => {
            backend.appends.push( { key, offset } )
            backend.size = offset
            const reader = stream.getReader()
            while( true ) {
                const { done, value } = await reader.read()
                if( done ) return backend.size
                backend.size += value.byteLength
            }
        } ),
        delete: vi.fn( async () => {
            backend.size = -1
        } ),
    }
    return backend
}

const create_sdk = info => ( {
    fileDownloadInfo: vi.fn( async () => info ),
    downloadFile: vi.fn( async () => new Blob( [
        new Uint8Array( [ 1, 2, 3 ] ),
        new Uint8Array( [ 4, 5, 6 ] ),
    ] ) ),
} )

describe( `Hugging Face SDK download`, () => {

    test( `uses the anonymous SDK path with Xet parallel downloads`, async () => {
        const info = {
            size: 6,
            etag: `"abc-123"`,
            url: download_url,
            xet: {
                hash: `hash`,
                refreshUrl: new URL( `https://huggingface.co/xet/refresh` ),
                reconstructionUrl: new URL( `https://huggingface.co/xet/reconstruct` ),
            },
        }
        const cache_manager = create_cache_manager()
        const storage_backend = create_backend()
        const storage = new MemoryStorage()
        const sdk = create_sdk( info )
        const progress = []

        const result = await download_hf_model_file_to_cache( {
            model,
            url: download_url,
            cache_manager,
            storage_backend,
            storage,
            access_token: ``,
            fetch_impl: vi.fn(),
            sdk,
            on_progress: update => progress.push( update ),
        } )

        const file_info_params = sdk.fileDownloadInfo.mock.calls[ 0 ][ 0 ]
        const download_params = sdk.downloadFile.mock.calls[ 0 ][ 0 ]

        expect( file_info_params ).toEqual( expect.objectContaining( {
            repo: model.hugging_face_repo,
            path: model.file_name,
            revision: `main`,
            hubUrl: `https://huggingface.co`,
            fetch: expect.any( Function ),
        } ) )
        expect( Object.hasOwn( file_info_params, `accessToken` ) ).toBe( false )
        expect( Object.hasOwn( download_params, `accessToken` ) ).toBe( false )
        expect( download_params ).toEqual( expect.objectContaining( {
            downloadInfo: info,
            parallelDownloads: true,
        } ) )
        expect( storage_backend.size ).toBe( 6 )
        expect( cache_manager.metadata_writes ).toEqual( [ {
            key: `cache-key`,
            metadata: {
                originalURL: download_url,
                originalSize: 6,
                etag: `abc123`,
            },
        } ] )
        expect( progress.at( -1 ) ).toEqual( { loaded: 6, total: 6 } )
        expect( storage.getItem( resume_key ) ).toBeNull()
        expect( result ).toEqual( {
            cache_key: `cache-key`,
            size: 6,
            etag: `abc123`,
            mode: `xet`,
            resumed_from: 0,
        } )
    } )

    test( `falls back to plain HTTP when byte streams are missing (iOS 16 Safari)`, async () => {
        const info = {
            size: 6,
            etag: `"abc-123"`,
            url: download_url,
            xet: { hash: `hash`, refreshUrl: new URL( `https://huggingface.co/x` ), reconstructionUrl: new URL( `https://huggingface.co/y` ) },
        }
        const sdk = create_sdk( info )

        // Safari < 16.4 throws "ReadableByteStreamController is not implemented"
        const NativeReadableStream = globalThis.ReadableStream
        vi.stubGlobal( `ReadableStream`, class extends NativeReadableStream {
            constructor( source, strategy ) {
                if( source?.type === `bytes` ) throw new TypeError( `ReadableByteStreamController is not implemented` )
                super( source, strategy )
            }
        } )

        try {
            const result = await download_hf_model_file_to_cache( {
                model,
                url: download_url,
                cache_manager: create_cache_manager(),
                storage_backend: create_backend(),
                storage: new MemoryStorage(),
                access_token: ``,
                fetch_impl: vi.fn(),
                sdk,
            } )

            expect( sdk.downloadFile.mock.calls[ 0 ][ 0 ].xet ).toBe( false )
            expect( result.mode ).toBe( `web` )
        } finally {
            vi.unstubAllGlobals()
        }
    } )

    test( `WebKit never uses the Xet reader, which crashes its tabs`, () => {
        const safari = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Safari/605.1.15`
        const ios_chrome = `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1`
        const chrome = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36`
        const firefox = `Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0`

        expect( can_use_xet( safari ) ).toBe( false )
        expect( can_use_xet( ios_chrome ) ).toBe( false )
        expect( can_use_xet( chrome ) ).toBe( true )
        expect( can_use_xet( firefox ) ).toBe( true )
    } )

    test( `forwards an optional token when one is configured`, async () => {
        const info = {
            size: 6,
            etag: `etag`,
            url: download_url,
        }
        const sdk = create_sdk( info )

        await download_hf_model_file_to_cache( {
            model,
            url: download_url,
            cache_manager: create_cache_manager(),
            storage_backend: create_backend(),
            storage: new MemoryStorage(),
            access_token: `hf_test`,
            sdk,
        } )

        expect( sdk.fileDownloadInfo.mock.calls[ 0 ][ 0 ].accessToken ).toBe( `hf_test` )
        expect( sdk.downloadFile.mock.calls[ 0 ][ 0 ].accessToken ).toBe( `hf_test` )
    } )

    test( `resumes a matching Xet prefix with a ranged slice`, async () => {
        const storage = new MemoryStorage()
        storage.setItem( resume_key, JSON.stringify( { etag: `etag`, total: 6, url: download_url } ) )
        const storage_backend = create_backend( 4 )
        const blob = new Blob( [ new Uint8Array( [ 1, 2, 3, 4, 5, 6 ] ) ] )
        const slice = vi.spyOn( blob, `slice` )
        const progress = []

        const result = await download_hf_model_file_to_cache( {
            model,
            url: download_url,
            cache_manager: create_cache_manager(),
            storage_backend,
            storage,
            access_token: ``,
            sdk: {
                fileDownloadInfo: vi.fn( async () => ( { size: 6, etag: `etag`, url: download_url, xet: { hash: `h` } } ) ),
                downloadFile: vi.fn( async () => blob ),
            },
            on_progress: update => progress.push( update ),
        } )

        expect( slice ).toHaveBeenCalledWith( 4 )
        expect( storage_backend.appends ).toEqual( [ { key: `cache-key`, offset: 4 } ] )
        expect( storage_backend.size ).toBe( 6 )
        expect( progress[ 0 ] ).toEqual( { loaded: 4, total: 6, resumed_from: 4 } )
        expect( progress.at( -1 ) ).toEqual( { loaded: 6, total: 6 } )
        expect( result.resumed_from ).toBe( 4 )
        expect( storage.getItem( resume_key ) ).toBeNull()
    } )

    // Plain HTTP resume: Range may not survive Hugging Face's CDN redirect
    const resume_web = async fetch_impl => {
        const storage = new MemoryStorage()
        storage.setItem( resume_key, JSON.stringify( { etag: `etag`, total: 6, url: download_url } ) )
        const storage_backend = create_backend( 4 )
        const result = await download_hf_model_file_to_cache( {
            model,
            url: download_url,
            cache_manager: create_cache_manager(),
            storage_backend,
            storage,
            access_token: ``,
            fetch_impl,
            sdk: {
                fileDownloadInfo: vi.fn( async () => ( { size: 6, etag: `etag`, url: download_url } ) ),
                downloadFile: vi.fn( async () => new Blob( [ new Uint8Array( 6 ) ] ) ),
            },
        } )
        return { result, storage_backend }
    }

    test( `plain HTTP resume appends the ranged tail`, async () => {
        const fetch_impl = vi.fn( async () => new Response( new Uint8Array( [ 5, 6 ] ), { status: 206 } ) )
        const { storage_backend } = await resume_web( fetch_impl )

        expect( fetch_impl.mock.calls[ 0 ][ 1 ].headers.Range ).toBe( `bytes=4-` )
        expect( storage_backend.appends ).toEqual( [ { key: `cache-key`, offset: 4 } ] )
        expect( storage_backend.size ).toBe( 6 )
    } )

    test( `plain HTTP resume restarts when the server ignores Range`, async () => {
        const fetch_impl = vi.fn( async () => new Response( new Uint8Array( 6 ), { status: 200 } ) )
        const { storage_backend } = await resume_web( fetch_impl )

        // Never the whole file appended after the prefix (iOS 16 ended at 704 of 688 MB)
        expect( storage_backend.appends ).toEqual( [ { key: `cache-key`, offset: 0 } ] )
        expect( storage_backend.size ).toBe( 6 )
    } )

    test( `plain HTTP resume retries the CDN URL when the redirect dropped Range`, async () => {
        const redirected = new Response( new Uint8Array( 6 ), { status: 200 } )
        Object.defineProperties( redirected, { redirected: { value: true }, url: { value: `https://cdn.test/file` } } )
        const fetch_impl = vi.fn()
            .mockResolvedValueOnce( redirected )
            .mockResolvedValueOnce( new Response( new Uint8Array( [ 5, 6 ] ), { status: 206 } ) )
        const { storage_backend } = await resume_web( fetch_impl )

        expect( fetch_impl.mock.calls[ 1 ][ 0 ] ).toBe( `https://cdn.test/file` )
        expect( fetch_impl.mock.calls[ 1 ][ 1 ].headers.Range ).toBe( `bytes=4-` )
        expect( storage_backend.appends ).toEqual( [ { key: `cache-key`, offset: 4 } ] )
    } )

    test( `starting a download sweeps other interrupted prefixes`, async () => {
        const storage = new MemoryStorage()
        storage.setItem( `partial_download:stale-key`, JSON.stringify( { etag: `old`, total: 9, url: `https://x/old.gguf` } ) )
        storage.setItem( `unrelated`, `kept` )
        const storage_backend = create_backend()
        storage_backend.delete = vi.fn( async () => {} )

        await download_hf_model_file_to_cache( {
            model,
            url: download_url,
            cache_manager: create_cache_manager(),
            storage_backend,
            storage,
            access_token: ``,
            sdk: {
                fileDownloadInfo: vi.fn( async () => ( { size: 6, etag: `etag`, url: download_url } ) ),
                downloadFile: vi.fn( async () => new Blob( [ new Uint8Array( 6 ) ] ) ),
            },
        } )

        expect( storage_backend.delete ).toHaveBeenCalledWith( `stale-key` )
        expect( storage_backend.delete ).not.toHaveBeenCalledWith( `cache-key` )
        expect( storage.getItem( `partial_download:stale-key` ) ).toBeNull()
        expect( storage.getItem( `unrelated` ) ).toBe( `kept` )
    } )

    test( `restarts when the remote revision changed`, async () => {
        const storage = new MemoryStorage()
        storage.setItem( resume_key, JSON.stringify( { etag: `old`, total: 6 } ) )
        const storage_backend = create_backend( 4 )

        await download_hf_model_file_to_cache( {
            model,
            url: download_url,
            cache_manager: create_cache_manager(),
            storage_backend,
            storage,
            access_token: ``,
            sdk: create_sdk( { size: 6, etag: `new`, url: download_url } ),
        } )

        expect( storage_backend.appends ).toEqual( [ { key: `cache-key`, offset: 0 } ] )
        expect( storage_backend.size ).toBe( 6 )
    } )

    test( `drops stale wllama metadata before writing new bytes`, async () => {
        const cache_manager = create_cache_manager( { originalURL: download_url, originalSize: 6 } )

        await download_hf_model_file_to_cache( {
            model,
            url: download_url,
            cache_manager,
            storage_backend: create_backend(),
            storage: new MemoryStorage(),
            access_token: ``,
            sdk: create_sdk( { size: 6, etag: `etag`, url: download_url } ),
        } )

        expect( cache_manager.delete ).toHaveBeenCalledWith( `cache-key` )
    } )

    test( `abort discards the partial file and never writes metadata`, async () => {
        const controller = new AbortController()
        const cache_manager = create_cache_manager()
        const storage_backend = create_backend()
        const storage = new MemoryStorage()

        // A source that never ends on its own, like a stalled Xet stream
        const endless = {
            stream: () => new ReadableStream( {
                pull( stream_controller ) {
                    stream_controller.enqueue( new Uint8Array( 1 ) )
                    return new Promise( resolve => setTimeout( resolve, 5 ) )
                },
            } ),
        }

        const pending = download_hf_model_file_to_cache( {
            model: { ...model, file_size_bytes: 1_000 },
            url: download_url,
            cache_manager,
            storage_backend,
            storage,
            access_token: ``,
            sdk: {
                fileDownloadInfo: vi.fn( async () => ( { size: 1_000, etag: `etag`, url: download_url } ) ),
                downloadFile: vi.fn( async () => endless ),
            },
            signal: controller.signal,
        } )
        setTimeout( () => controller.abort(), 30 )

        await expect( pending ).rejects.toMatchObject( { name: `AbortError` } )
        expect( storage_backend.delete ).toHaveBeenCalledWith( `cache-key` )
        expect( cache_manager.writeMetadata ).not.toHaveBeenCalled()
        expect( storage.getItem( resume_key ) ).toBeNull()
    } )

    test( `a network failure keeps the prefix for a later resume`, async () => {
        const storage_backend = create_backend()
        const storage = new MemoryStorage()
        const failing = {
            stream: () => new ReadableStream( {
                start( stream_controller ) {
                    stream_controller.enqueue( new Uint8Array( 3 ) )
                    stream_controller.error( new Error( `network down` ) )
                },
            } ),
        }

        await expect( download_hf_model_file_to_cache( {
            model,
            url: download_url,
            cache_manager: create_cache_manager(),
            storage_backend,
            storage,
            access_token: ``,
            sdk: {
                fileDownloadInfo: vi.fn( async () => ( { size: 6, etag: `etag`, url: download_url } ) ),
                downloadFile: vi.fn( async () => failing ),
            },
        } ) ).rejects.toThrow( `network down` )

        expect( storage_backend.delete ).not.toHaveBeenCalled()
        expect( JSON.parse( storage.getItem( resume_key ) ) ).toMatchObject( { etag: `etag`, total: 6 } )
    } )

    test( `sweep keeps the record when the delete fails`, async () => {
        const storage = new MemoryStorage()
        storage.setItem( stale_key, stale_record )
        const storage_backend = { delete: vi.fn( async () => {
            throw Object.assign( new Error( `busy` ), { name: `NoModificationAllowedError` } )
        } ) }

        await sweep_partial_downloads( { storage_backend, storage } )

        expect( storage_backend.delete ).toHaveBeenCalledWith( `stale-key` )
        expect( storage.getItem( stale_key ) ).toBe( stale_record )
    } )

    test( `sweep never touches a download whose lock another tab holds`, async () => {
        const storage = new MemoryStorage()
        storage.setItem( stale_key, stale_record )
        const storage_backend = { delete: vi.fn( async () => {} ) }
        const release = await hold_lock( `gratis-download:stale-key` )

        await sweep_partial_downloads( { storage_backend, storage } )
        release()

        expect( storage_backend.delete ).not.toHaveBeenCalled()
        expect( storage.getItem( stale_key ) ).toBe( stale_record )
    } )

    test( `sweep is skipped entirely without Web Locks`, async () => {
        const storage = new MemoryStorage()
        storage.setItem( stale_key, stale_record )
        const storage_backend = { delete: vi.fn( async () => {} ) }

        await sweep_partial_downloads( { storage_backend, storage, locks: null } )

        expect( storage_backend.delete ).not.toHaveBeenCalled()
        expect( storage.getItem( stale_key ) ).toBe( stale_record )
    } )

    test( `downloads still work without Web Locks`, async () => {
        const storage_backend = create_backend()

        await download_hf_model_file_to_cache( {
            model,
            url: download_url,
            cache_manager: create_cache_manager(),
            storage_backend,
            storage: new MemoryStorage(),
            access_token: ``,
            sdk: create_sdk( { size: 6, etag: `etag`, url: download_url } ),
            locks: null,
        } )

        expect( storage_backend.size ).toBe( 6 )
    } )

    test( `holds the download lock for the whole attempt`, async () => {
        let held = []
        const sdk = create_sdk( { size: 6, etag: `etag`, url: download_url } )
        sdk.fileDownloadInfo = vi.fn( async () => {
            held = ( await navigator.locks.query() ).held.map( ( { name } ) => name )
            return { size: 6, etag: `etag`, url: download_url }
        } )

        await download_hf_model_file_to_cache( {
            model,
            url: download_url,
            cache_manager: create_cache_manager(),
            storage_backend: create_backend(),
            storage: new MemoryStorage(),
            access_token: ``,
            sdk,
        } )

        expect( held ).toContain( `gratis-download:cache-key` )
    } )

    test( `deletes an incompatible prefix before recording the new revision`, async () => {
        const storage = new MemoryStorage()
        storage.setItem( resume_key, JSON.stringify( { etag: `old`, total: 6 } ) )
        const storage_backend = create_backend( 4 )
        const record_at_delete = []
        const delete_prefix = storage_backend.delete
        storage_backend.delete = vi.fn( async key => {
            record_at_delete.push( storage.getItem( resume_key ) )
            return delete_prefix( key )
        } )

        await download_hf_model_file_to_cache( {
            model,
            url: download_url,
            cache_manager: create_cache_manager(),
            storage_backend,
            storage,
            access_token: ``,
            sdk: create_sdk( { size: 6, etag: `new`, url: download_url } ),
        } )

        expect( storage_backend.delete ).toHaveBeenCalledWith( `cache-key` )
        expect( record_at_delete ).toEqual( [ null ] )
        expect( storage_backend.appends ).toEqual( [ { key: `cache-key`, offset: 0 } ] )
    } )

    test( `a failed prefix delete leaves no record that could validate stale bytes`, async () => {
        const storage = new MemoryStorage()
        storage.setItem( resume_key, JSON.stringify( { etag: `old`, total: 6 } ) )
        const storage_backend = create_backend( 4 )
        storage_backend.delete = vi.fn( async () => {
            throw new Error( `locked` )
        } )

        await expect( download_hf_model_file_to_cache( {
            model,
            url: download_url,
            cache_manager: create_cache_manager(),
            storage_backend,
            storage,
            access_token: ``,
            sdk: create_sdk( { size: 6, etag: `new`, url: download_url } ),
        } ) ).rejects.toThrow( `locked` )

        expect( storage_backend.append ).not.toHaveBeenCalled()
        expect( storage.getItem( resume_key ) ).toBeNull()
    } )

    test( `cancel during the metadata lookup discards an existing prefix`, async () => {
        const controller = new AbortController()
        const storage = new MemoryStorage()
        storage.setItem( resume_key, JSON.stringify( { etag: `etag`, total: 6 } ) )
        const storage_backend = create_backend( 4 )

        const pending = download_hf_model_file_to_cache( {
            model,
            url: download_url,
            cache_manager: create_cache_manager(),
            storage_backend,
            storage,
            access_token: ``,
            sdk: {
                fileDownloadInfo: vi.fn( () => new Promise( ( _, reject ) => {
                    controller.signal.addEventListener( `abort`, () => reject( Object.assign( new Error( `aborted` ), { name: `AbortError` } ) ) )
                } ) ),
                downloadFile: vi.fn(),
            },
            signal: controller.signal,
        } )
        setTimeout( () => controller.abort(), 5 )

        await expect( pending ).rejects.toMatchObject( { name: `AbortError` } )
        expect( storage_backend.delete ).toHaveBeenCalledWith( `cache-key` )
        expect( storage.getItem( resume_key ) ).toBeNull()
    } )

    test( `discard_partial_download removes a kept prefix after the lock frees`, async () => {
        const storage = new MemoryStorage()
        storage.setItem( resume_key, JSON.stringify( { etag: `etag`, total: 6 } ) )
        const storage_backend = create_backend( 3 )
        const release = await hold_lock( `gratis-download:cache-key` )

        const pending = discard_partial_download( { url: download_url, cache_manager: create_cache_manager(), storage_backend, storage } )
        await new Promise( resolve => setTimeout( resolve, 10 ) )
        expect( storage_backend.delete ).not.toHaveBeenCalled()

        release()
        await pending

        expect( storage_backend.delete ).toHaveBeenCalledWith( `cache-key` )
        expect( storage.getItem( resume_key ) ).toBeNull()
    } )

    test( `get_resume_offset only trusts a matching prefix that fits`, () => {
        const record = { etag: `e`, total: 10 }
        expect( get_resume_offset( { record, stored_size: 4, etag: `e`, total: 10 } ) ).toBe( 4 )
        expect( get_resume_offset( { record, stored_size: 10, etag: `e`, total: 10 } ) ).toBe( 10 )
        expect( get_resume_offset( { record, stored_size: 11, etag: `e`, total: 10 } ) ).toBe( 0 )
        expect( get_resume_offset( { record, stored_size: -1, etag: `e`, total: 10 } ) ).toBe( 0 )
        expect( get_resume_offset( { record, stored_size: 4, etag: `other`, total: 10 } ) ).toBe( 0 )
        expect( get_resume_offset( { record, stored_size: 4, etag: `e`, total: 12 } ) ).toBe( 0 )
        expect( get_resume_offset( { record: null, stored_size: 4, etag: `e`, total: 10 } ) ).toBe( 0 )
    } )

    test( `abortable_stream errors the reader as soon as the signal fires`, async () => {
        const controller = new AbortController()
        const cancel = vi.fn()
        const source = new ReadableStream( { pull: () => new Promise( () => {} ), cancel } )
        const reader = abortable_stream( source, controller.signal ).getReader()

        const read = reader.read()
        controller.abort()

        await expect( read ).rejects.toMatchObject( { name: `AbortError` } )
        expect( cancel ).toHaveBeenCalled()
    } )

    test( `can write the SDK stream to an external browser file`, async () => {
        const info = {
            size: 6,
            etag: `etag`,
            url: download_url,
        }
        const sdk = create_sdk( info )
        const writes = []
        const writable = {
            write: vi.fn( async chunk => writes.push( chunk.byteLength ) ),
            close: vi.fn(),
            abort: vi.fn(),
        }
        const file_handle = {
            createWritable: vi.fn( async () => writable ),
        }

        const result = await download_hf_model_file_to_external_file( {
            model,
            file_handle,
            access_token: ``,
            sdk,
        } )

        expect( sdk.downloadFile.mock.calls[ 0 ][ 0 ].parallelDownloads ).toBe( true )
        expect( writes.reduce( ( total, size ) => total + size, 0 ) ).toBe( 6 )
        expect( writable.close ).toHaveBeenCalledOnce()
        expect( result ).toEqual( {
            size: 6,
            etag: `etag`,
            mode: `web`,
        } )
    } )

} )
