import { test, expect } from '@playwright/test'
import { MODELS } from '../fixtures/test_models'
import { download_model_via_ui } from '../helpers/download_model'

const DB_NAME = `gratis-db`

/** Read (or patch) one IndexedDB model entry inside the page. */
const model_entry = ( page, id, patch = null ) => page.evaluate( ( { db_name, id, patch } ) => new Promise( ( resolve, reject ) => {
    const request = indexedDB.open( db_name )
    request.onerror = () => reject( request.error )
    request.onsuccess = () => {
        const store = request.result.transaction( `models`, `readwrite` ).objectStore( `models` )
        const get = store.get( id )
        get.onsuccess = () => {
            if( get.result && patch ) store.put( { ...get.result, ...patch } )
            resolve( get.result ? { ...get.result, ...patch } : null )
        }
        get.onerror = () => reject( get.error )
    }
} ), { db_name: DB_NAME, id, patch } )

/** Flip one byte in the middle of the largest OPFS file: same size, same magic, wrong weights. */
const corrupt_largest_opfs_file = page => page.evaluate( async () => {
    const root = await navigator.storage.getDirectory()
    const cache = await root.getDirectoryHandle( `cache` )
    let largest = null
    for await ( const [ name, handle ] of cache.entries() ) {
        if( handle.kind !== `file` ) continue
        const file = await handle.getFile()
        if( !largest || file.size > largest.size ) largest = { name, handle, size: file.size }
    }
    const offset = Math.floor( largest.size / 2 )
    const [ byte ] = new Uint8Array( await ( await largest.handle.getFile() ).slice( offset, offset + 1 ).arrayBuffer() )
    const writable = await largest.handle.createWritable( { keepExistingData: true } )
    await writable.write( { type: `write`, position: offset, data: new Uint8Array( [ byte ^ 0xff ] ) } )
    await writable.close()
    return largest.size
} )

test.describe( `Model checksums`, () => {

    test.setTimeout( 600_000 )

    test( `downloads are SHA-256 verified; a corrupted install is caught on load`, async ( { page } ) => {

        const logs = []
        page.on( `console`, message => logs.push( message.text() ) )

        await download_model_via_ui( page, MODELS.smollm2 )

        // The download hashed what OPFS actually stored
        expect( logs.some( line => /\[checksum\] SHA-256 verified/.test( line ) ) ).toBe( true )
        expect( ( await model_entry( page, MODELS.smollm2.id ) )?.sha256_verified ).toBe( true )

        // Simulate a pre-checksum install whose weights rotted on disk
        expect( await corrupt_largest_opfs_file( page ) ).toBe( MODELS.smollm2.file_size_bytes )
        await model_entry( page, MODELS.smollm2.id, { sha256_verified: false } )

        await page.reload()
        await expect( page.getByText( /checksum mismatch/i ).first() ).toBeVisible( { timeout: 120_000 } )

        // The corrupt install is gone, so the next attempt downloads it fresh
        expect( await model_entry( page, MODELS.smollm2.id ) ).toBeNull()

    } )

} )
