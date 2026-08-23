import { test, expect } from '@playwright/test'

test( `reliable OPFS backend writes and verifies a streamed file`, async ( { page } ) => {
    await page.goto( `/` )

    const result = await page.evaluate( async () => {
        const { ReliableOPFSBackend } = await import( `/src/utils/reliable_opfs_backend.js` )
        const backend = new ReliableOPFSBackend()
        const key = `opfs-backend-smoke.bin`
        const chunks = [
            new Uint8Array( 1024 * 1024 ).fill( 0x41 ),
            new Uint8Array( 1024 * 1024 ).fill( 0x42 ),
        ]
        const stream = new ReadableStream( {
            start( controller ) {
                for( const chunk of chunks ) controller.enqueue( chunk )
                controller.close()
            },
        } )

        await backend.write( key, stream )
        const file = await backend.read( key )
        const listed = await backend.list()
        const first = new Uint8Array( await file.slice( 0, 1 ).arrayBuffer() )[ 0 ]
        const last = new Uint8Array( await file.slice( -1 ).arrayBuffer() )[ 0 ]
        await backend.delete( key )

        return {
            first,
            last,
            listed_size: listed.find( entry => entry.key === key )?.size,
            size: file.size,
            removed: await backend.getSize( key ),
        }
    } )

    expect( result ).toEqual( {
        first: 0x41,
        last: 0x42,
        listed_size: 2 * 1024 * 1024,
        size: 2 * 1024 * 1024,
        removed: -1,
    } )
} )
