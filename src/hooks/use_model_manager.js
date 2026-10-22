import { useState, useEffect, useCallback } from 'react'
import { log } from 'mentie'
import { get_db } from '../stores/db'
import { delete_browser_model } from '../utils/model_download'
import use_llm from '../stores/llm_store'
import { storage_key, EVENTS } from '../utils/branding'

const active_model_key = storage_key( `active_model_id` )

// Runtime check — true when running inside Electron
const is_electron = !!window.electronAPI?.native_inference

/**
 * Hook for managing cached models.
 * In Electron, reads from the filesystem manifest via IPC.
 * In browser, reads from IndexedDB.
 * @returns {Object} Model management state and operations
 */
export default function use_model_manager() {

    const [ cached_models, set_cached_models ] = useState( [] )
    const [ storage_used, set_storage_used ] = useState( 0 )
    const [ storage_estimate, set_storage_estimate ] = useState( null )
    const [ is_loading, set_is_loading ] = useState( false )

    /**
     * Load all cached models, sorted by last_used_at (most recent first)
     */
    const refresh_models = useCallback( async () => {

        try {

            if( is_electron ) {

                // Electron path: read from filesystem manifest via IPC
                const all = await window.electronAPI.list_models()
                const sorted = [ ...all ]
                    .sort( ( a, b ) => ( b.last_used_at || 0 ) - ( a.last_used_at || 0 ) )
                    .filter( ( m ) => m.category !== `voice` )

                const total_bytes = sorted.reduce( ( sum, m ) => sum + ( m.file_size_bytes || 0 ), 0 )
                set_storage_used( total_bytes )
                set_cached_models( sorted )
                log.debug( `[models] Refreshed (electron): ${ sorted.length } models, ${ ( total_bytes / 1e6 ).toFixed( 0 ) } MB` )
                return

            }

            // Browser path: read from IndexedDB
            const db = await get_db()
            const all = await db.getAllFromIndex( `models`, `last_used_at` )
            // Reverse to get most recent first, and filter out voice models (e.g. Parakeet)
            const sorted = all.reverse().filter( ( m ) => m.category !== `voice` )

            // Calculate total storage (excluding blob from display data)
            const total_bytes = sorted.reduce( ( sum, m ) => sum + ( m.file_size_bytes || 0 ), 0 )
            set_storage_used( total_bytes )
            set_cached_models( sorted.map( ( { blob, ...rest } ) => rest ) )
            log.debug( `[models] Refreshed (browser): ${ sorted.length } models, ${ ( total_bytes / 1e6 ).toFixed( 0 ) } MB` )

            // Estimate available storage
            if( navigator.storage?.estimate ) {
                const estimate = await navigator.storage.estimate()
                set_storage_estimate( estimate.quota - estimate.usage )
            }

        } catch ( err ) {
            log.error( `Failed to load cached models:`, err )
        }

    }, [] )

    // Load on mount, and again whenever any instance purges or changes models
    useEffect( () => {
        refresh_models()
        window.addEventListener( EVENTS.models_changed, refresh_models )
        return () => window.removeEventListener( EVENTS.models_changed, refresh_models )
    }, [ refresh_models ] )

    /**
     * Delete a cached model. Deleting the active model unloads it first, since
     * OPFS cannot remove a file the WASM worker still holds open.
     * @param {string} model_id - The model ID to delete
     * @returns {Promise<void>}
     */
    const delete_model = useCallback( async ( model_id ) => {

        const was_active = model_id === localStorage.getItem( active_model_key )

        set_is_loading( true )
        try {

            if( was_active ) {
                await use_llm.getState().unload_model()
                localStorage.removeItem( active_model_key )
            }

            if( is_electron ) {
                // Electron path: delete via IPC
                await window.electronAPI.delete_model( model_id )
            } else {
                // Browser path: delete both OPFS data and IndexedDB metadata.
                const db = await get_db()
                const cached = await db.get( `models`, model_id )
                await delete_browser_model( cached || model_id )
            }

            log.info( `[models] Deleted model ${ model_id }` )
            await refresh_models()
            window.dispatchEvent( new Event( EVENTS.models_changed ) )

        } catch ( err ) {

            // Files are still there: keep it as the active model
            if( was_active ) localStorage.setItem( active_model_key, model_id )
            throw err

        } finally {
            set_is_loading( false )
        }

    }, [ refresh_models ] )

    return {
        cached_models,
        storage_used,
        storage_estimate,
        is_loading,
        delete_model,
        refresh_models,
    }

}
