import { openDB } from 'idb'
import { log } from 'mentie'
import { DB_NAME } from '../utils/branding'

const DB_VERSION = 1

/**
 * Opens (or creates) the gratisAI IndexedDB database
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

            // Model metadata. Legacy entries may contain GGUF blobs; new browser
            // downloads keep weights in wllama64's streaming OPFS cache.
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
