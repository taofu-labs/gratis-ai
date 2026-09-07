import { describe, expect, test, vi } from 'vitest'
import {
    download_hf_model_file_to_cache,
    download_hf_model_file_to_external_file,
} from '../../src/utils/hf_sdk_download'

const model = {
    hugging_face_repo: `tpnlabs/test-model`,
    file_name: `test-model-Q4_K_M.gguf`,
    file_size_bytes: 6,
}

const download_url = `https://huggingface.co/tpnlabs/test-model/resolve/main/test-model-Q4_K_M.gguf`

const read_stream_size = async stream => {
    const reader = stream.getReader()
    let bytes = 0

    while( true ) {
        const { done, value } = await reader.read()
        if( done ) return bytes
        bytes += value.byteLength || 0
    }
}

const create_cache_manager = () => {
    const writes = []
    return {
        writes,
        getNameFromURL: vi.fn( async () => `cache-key` ),
        write: vi.fn( async ( key, stream, metadata ) => {
            writes.push( {
                key,
                metadata,
                bytes: await read_stream_size( stream ),
            } )
        } ),
        delete: vi.fn(),
    }
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
        const sdk = create_sdk( info )
        const progress = []

        const result = await download_hf_model_file_to_cache( {
            model,
            url: download_url,
            cache_manager,
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
        expect( cache_manager.writes[ 0 ] ).toEqual( {
            key: `cache-key`,
            bytes: 6,
            metadata: {
                originalURL: download_url,
                originalSize: 6,
                etag: `abc123`,
            },
        } )
        expect( progress.at( -1 ) ).toEqual( { loaded: 6, total: 6 } )
        expect( result ).toEqual( {
            cache_key: `cache-key`,
            size: 6,
            etag: `abc123`,
            mode: `xet`,
        } )
    } )

    test( `forwards an optional token when one is configured`, async () => {
        const info = {
            size: 6,
            etag: `etag`,
            url: download_url,
        }
        const cache_manager = create_cache_manager()
        const sdk = create_sdk( info )

        await download_hf_model_file_to_cache( {
            model,
            url: download_url,
            cache_manager,
            access_token: `hf_test`,
            sdk,
        } )

        expect( sdk.fileDownloadInfo.mock.calls[ 0 ][ 0 ].accessToken ).toBe( `hf_test` )
        expect( sdk.downloadFile.mock.calls[ 0 ][ 0 ].accessToken ).toBe( `hf_test` )
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
