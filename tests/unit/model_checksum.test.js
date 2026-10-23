import { createHash } from 'crypto'
import { describe, expect, test, vi } from 'vitest'
import { lookup_sha256 as lookup_sha256_native } from '../../electron/model_files.js'
import { ChecksumError, as_sha256, sha256_of_files, verify_sha256 } from '../../src/utils/model_checksum.js'

const sha256 = bytes => createHash( `sha256` ).update( bytes ).digest( `hex` )

// Three shards of a fake 3 MB "model" — big enough to stream in several chunks
const bytes = Uint8Array.from( { length: 3 * 1024 * 1024 }, ( _, index ) => index * 31 % 251 )
const shards = [ bytes.subarray( 0, 1_000_000 ), bytes.subarray( 1_000_000, 2_500_000 ), bytes.subarray( 2_500_000 ) ]
    .map( part => new Blob( [ part ] ) )

describe( `model checksums`, () => {

    test( `reads SHA-256 digests out of Hugging Face etags`, () => {

        const digest = `4fdc32e4052f65f4b73e00186d8f41b716d6b84661ec899d29192024226d4640`

        expect( as_sha256( `"${ digest }"` ) ).toBe( digest )
        expect( as_sha256( digest.toUpperCase() ) ).toBe( digest )

        // Git (SHA-1) etags of small files and empty values are not digests
        expect( as_sha256( `"295e2c5834a407e829b37e337a123d27d1458516"` ) ).toBeNull()
        expect( as_sha256( `` ) ).toBeNull()
        expect( as_sha256( undefined ) ).toBeNull()

    } )

    test( `hashes shards in order as one file and reports progress`, async () => {

        const on_progress = vi.fn()
        const digest = await sha256_of_files( shards, { on_progress } )

        expect( digest ).toBe( sha256( bytes ) )
        expect( on_progress ).toHaveBeenLastCalledWith( { hashed: bytes.byteLength, total: bytes.byteLength } )

    } )

    test( `rejects a single flipped byte`, async () => {

        const corrupt = bytes.slice()
        corrupt[ 1_234_567 ] ^= 0xff

        await expect( verify_sha256( [ new Blob( [ corrupt ] ) ], sha256( bytes ) ) ).rejects.toBeInstanceOf( ChecksumError )
        await expect( verify_sha256( shards, sha256( bytes ) ) ).resolves.toBe( true )

    } )

    test( `skips verification when no digest is known`, async () => {

        await expect( verify_sha256( shards, null ) ).resolves.toBe( false )

    } )

    test( `stops hashing when aborted`, async () => {

        const controller = new AbortController()
        controller.abort()

        await expect( sha256_of_files( shards, { signal: controller.signal } ) ).rejects.toMatchObject( { name: `AbortError` } )

    } )

    test( `Electron reads the digest from the resolve redirect without following it`, async () => {

        const digest = sha256( bytes )
        const fetch_mock = vi.fn( async () => new Response( null, { status: 302, headers: { 'x-linked-etag': `"${ digest }"` } } ) )
        vi.stubGlobal( `fetch`, fetch_mock )

        try {
            expect( await lookup_sha256_native( `https://huggingface.co/a/b/resolve/main/m.gguf` ) ).toBe( digest )
            expect( fetch_mock.mock.calls[ 0 ][ 1 ] ).toMatchObject( { method: `HEAD`, redirect: `manual` } )

            fetch_mock.mockRejectedValueOnce( new Error( `offline` ) )
            expect( await lookup_sha256_native( `https://huggingface.co/a/b/resolve/main/m.gguf` ) ).toBeNull()
        } finally {
            vi.unstubAllGlobals()
        }

    } )

} )
