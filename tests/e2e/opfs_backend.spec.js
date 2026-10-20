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

test( `reliable OPFS backend resumes a kept prefix with append`, async ( { page } ) => {
    await page.goto( `/` )

    const result = await page.evaluate( async () => {
        const { ReliableOPFSBackend } = await import( `/src/utils/reliable_opfs_backend.js` )
        const backend = new ReliableOPFSBackend()
        const key = `opfs-backend-resume.bin`
        const MIB = 1024 * 1024
        const stream_of = ( ...chunks ) => new ReadableStream( {
            start( controller ) {
                for( const chunk of chunks ) controller.enqueue( chunk )
                controller.close()
            },
        } )

        // An interrupted first attempt: the source errors after one MiB
        let pulls = 0
        const failing = new ReadableStream( {
            pull( controller ) {
                if( pulls++ === 0 ) controller.enqueue( new Uint8Array( MIB ).fill( 0x41 ) )
                else controller.error( new Error( `network down` ) )
            },
        } )
        const failure = await backend.append( key, failing ).then( () => null, error => error.message )
        const kept = await backend.getSize( key )

        // Resume at the kept prefix with the remaining bytes
        const stored = await backend.append( key, stream_of( new Uint8Array( MIB ).fill( 0x42 ) ), { offset: kept } )
        const file = await backend.read( key )
        const first = new Uint8Array( await file.slice( 0, 1 ).arrayBuffer() )[ 0 ]
        const last = new Uint8Array( await file.slice( -1 ).arrayBuffer() )[ 0 ]
        const past_end = await backend.append( key, stream_of(), { offset: 3 * MIB } ).then( () => null, error => error.message )
        await backend.delete( key )

        return { failure, kept, stored, first, last, past_end: !!past_end }
    } )

    expect( result ).toEqual( {
        failure: `network down`,
        kept: 1024 * 1024,
        stored: 2 * 1024 * 1024,
        first: 0x41,
        last: 0x42,
        past_end: true,
    } )
} )
