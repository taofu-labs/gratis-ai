import { openDB } from 'idb'
import { log } from 'mentie'
import { DB_NAME } from '../utils/branding'

const DB_VERSION = 1
const LEGACY_DB_NAMES = [ `gratisai-db` ]

/**
 * Opens (or creates) the Gratis IndexedDB database
 * @returns {Promise<import('idb').IDBPDatabase>}
 */
export const get_db = async () => {

    log.debug( `[db] Opening "${ DB_NAME }" v${ DB_VERSION }` )

    return openDB( DB_NAME, DB_VERSION, {

        upgrade( db ) {

            log.info( `[db] Schema upgrade — creating object stores` )

            // Conversations store
            if( !db.objectStoreNames.contains( `conversations` ) ) {
                const conv_store = db.createObjectStore( `conversations`, { keyPath: `id` } )
                conv_store.createIndex( `updated_at`, `updated_at` )
            }

            // Messages store
            if( !db.objectStoreNames.contains( `messages` ) ) {
                const msg_store = db.createObjectStore( `messages`, { keyPath: `id` } )
                msg_store.createIndex( `conversation_id`, `conversation_id` )
            }

            // Models store (cached GGUF blobs + metadata)
            if( !db.objectStoreNames.contains( `models` ) ) {
                const model_store = db.createObjectStore( `models`, { keyPath: `id` } )
                model_store.createIndex( `last_used_at`, `last_used_at` )
                model_store.createIndex( `category`, `category` )
            }

        },

    } )

}

/**
 * Clear all data from all stores
 * @returns {Promise<void>}
 */
export const clear_all_data = async () => {

    log.warn( `[db] Clearing ALL data from all stores` )
    const db = await get_db()
    const tx = db.transaction( [ `conversations`, `messages`, `models` ], `readwrite` )
    await Promise.all( [
        tx.objectStore( `conversations` ).clear(),
        tx.objectStore( `messages` ).clear(),
        tx.objectStore( `models` ).clear(),
        tx.done,
    ] )

}

const delete_database = ( name ) => new Promise( ( resolve ) => {

    if( typeof indexedDB === `undefined` ) {
        resolve()
        return
    }

    const request = indexedDB.deleteDatabase( name )
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()

} )

/**
 * Clear legacy IndexedDB databases from previous branding.
 * @returns {Promise<void>}
 */
export const clear_legacy_data = async () => {

    await Promise.all(
        LEGACY_DB_NAMES
            .filter( name => name !== DB_NAME )
            .map( delete_database ),
    )

}

/**
 * Clear Cache Storage entries owned by this origin.
 * @returns {Promise<void>}
 */
export const clear_browser_caches = async () => {

    if( typeof caches === `undefined` ) return

    const keys = await caches.keys()
    await Promise.all( keys.map( key => caches.delete( key ) ) )

}
