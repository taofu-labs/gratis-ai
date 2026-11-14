import { openDB, deleteDB } from 'idb'
import { log } from 'mentie'
import { DB_NAME } from '../utils/branding'

const DB_VERSION = 1
const LEGACY_MODEL_CACHE = `hf-model-cache`
let legacy_cache_cleanup = null
let schema_check = null

const clear_legacy_model_cache = async () => {

    if( !( `caches` in globalThis ) ) return

    const removed = await caches.delete( LEGACY_MODEL_CACHE )
    if( removed ) log.info( `[db] Removed legacy duplicate model cache` )

}

/**
 * A database created without our schema (opened before the app ever ran, or a
 * browser's half-cleared storage) already has the right version: `upgrade`
 * never runs again and every transaction throws. It holds nothing, so drop it
 * and let the next open rebuild the stores.
 * @returns {Promise<void>}
 */
const drop_schemaless_db = async () => {

    const db = await open_db()
    const schemaless = !db.objectStoreNames.length
    db.close()
    if( !schemaless ) return

    log.warn( `[db] "${ DB_NAME }" has no object stores, recreating it` )
    await deleteDB( DB_NAME )

}

/**
 * Opens (or creates) the gratisAI IndexedDB database
 * @returns {Promise<import('idb').IDBPDatabase>}
 */
export const get_db = async () => {

    log.debug( `[db] Opening "${ DB_NAME }" v${ DB_VERSION }` )

    // Versions before OPFS also cached every Hugging Face response through
    // Workbox. Removing the obsolete route does not delete those multi-GB
    // duplicates, so clean the named cache once per app session.
    legacy_cache_cleanup ||= clear_legacy_model_cache().catch( error => {
        log.warn( `[db] Could not remove legacy model cache:`, error )
    } )
    await legacy_cache_cleanup

    // Once per app session, shared by concurrent callers
    schema_check ||= drop_schemaless_db().catch( error => {
        log.warn( `[db] Could not check the schema:`, error )
    } )
    await schema_check

    return open_db()

}

const open_db = () => {

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
