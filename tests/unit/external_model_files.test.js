import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    choose_external_model_file,
    should_use_external_model_file,
    take_pending_external_model_file,
    write_stream_to_external_model_file,
} from '../../src/utils/external_model_files'

const stream_from_sizes = sizes => new ReadableStream( {
    start( controller ) {
        for( const size of sizes ) controller.enqueue( new Uint8Array( size ) )
        controller.close()
    },
} )

describe( `external browser model files`, () => {

    afterEach( () => {
        vi.unstubAllGlobals()
    } )

    test( `uses a picked file for browser models over 2GB`, async () => {
        const handle = { createWritable: vi.fn() }
        vi.stubGlobal( `window`, {
            showSaveFilePicker: vi.fn( async () => handle ),
        } )

        const model = {
            id: `large-model`,
            file_name: `large-model.gguf`,
            file_size_bytes: 2_500_000_000,
        }

        expect( should_use_external_model_file( model ) ).toBe( true )
        await choose_external_model_file( model )
        expect( window.showSaveFilePicker ).toHaveBeenCalledWith( expect.objectContaining( {
            suggestedName: `large-model.gguf`,
        } ) )
        expect( take_pending_external_model_file( model.id ) ).toBe( handle )
        expect( take_pending_external_model_file( model.id ) ).toBeUndefined()
    } )

    test( `streams bytes to the external file handle with progress`, async () => {
        const writes = []
        const writable = {
            write: vi.fn( async chunk => writes.push( chunk.byteLength ) ),
            close: vi.fn(),
            abort: vi.fn(),
        }
        const handle = {
            createWritable: vi.fn( async () => writable ),
        }
        const progress = []

        const bytes = await write_stream_to_external_model_file( handle, stream_from_sizes( [ 2, 3 ] ), {
            expected_size: 5,
            on_progress: update => progress.push( update ),
        } )

        expect( bytes ).toBe( 5 )
        expect( writes ).toEqual( [ 2, 3 ] )
        expect( writable.close ).toHaveBeenCalledOnce()
        expect( writable.abort ).not.toHaveBeenCalled()
        expect( progress ).toEqual( [
            { loaded: 2, total: 5 },
            { loaded: 5, total: 5 },
        ] )
    } )

} )
