import { describe, expect, test, vi } from 'vitest'
import {
    abortable_stream,
    download_hf_model_file_to_cache,
    download_hf_model_file_to_external_file,
    get_resume_offset,
} from '../../src/utils/hf_sdk_download'

const model = {
    hugging_face_repo: `tpnlabs/test-model`,
    file_name: `test-model-Q4_K_M.gguf`,
    file_size_bytes: 6,
}

const download_url = `https://huggingface.co/tpnlabs/test-model/resolve/main/test-model-Q4_K_M.gguf`
const resume_key = `partial_download:cache-key`

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

    test( `resumes a matching OPFS prefix with a ranged slice`, async () => {
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
                fileDownloadInfo: vi.fn( async () => ( { size: 6, etag: `etag`, url: download_url } ) ),
                downloadFile: vi.fn( async () => blob ),
            },
            on_progress: update => progress.push( update ),
        } )

        expect( slice ).toHaveBeenCalledWith( 4 )
        expect( storage_backend.appends ).toEqual( [ { key: `cache-key`, offset: 4 } ] )
        expect( storage_backend.size ).toBe( 6 )
        expect( progress[ 0 ] ).toEqual( { loaded: 4, total: 6 } )
        expect( progress.at( -1 ) ).toEqual( { loaded: 6, total: 6 } )
        expect( result.resumed_from ).toBe( 4 )
        expect( storage.getItem( resume_key ) ).toBeNull()
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
