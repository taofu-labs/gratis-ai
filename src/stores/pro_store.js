import { create } from 'zustand'
import { log } from 'mentie'
import { storage_key } from '../utils/branding'
import { gratis_fetch, is_signed_in, pro_available, sign_out, start_sign_in } from '../utils/gratis_auth'
import { is_cloud_model } from '../providers/gratis_provider'
import use_llm_store from './llm_store'

const SHOW_KEY = storage_key( `show_pro_models` )

const read_show = () => {
    try {
        return localStorage.getItem( SHOW_KEY ) !== `0`
    } catch {
        return true
    }
}

/**
 * Gratis Pro UI state: session, weekly allowance, explainer dialog.
 * Local inference never depends on anything in here.
 */
const use_pro_store = create( ( set, get ) => ( {

    available: pro_available(),
    signed_in: is_signed_in(),

    // { percent_used, resets_at, tier: { id, name }, can_infer } from /v1/usage
    usage: null,

    // Hide the cloud section of the model menu for people who never want it
    show_pro_models: read_show(),

    explainer_open: false,

    open_explainer: () => set( { explainer_open: true } ),
    close_explainer: () => set( { explainer_open: false } ),

    set_show_pro_models: show => {
        try {
            localStorage.setItem( SHOW_KEY, show ? `1` : `0` )
        } catch { /* private mode: keep it for this session */ }
        set( { show_pro_models: show } )
    },

    sign_in: return_to => start_sign_in( return_to ),

    /** Sign out and fall back to on-device inference */
    sign_out: async () => {

        const { loaded_model_id, unload_model } = use_llm_store.getState()
        if( is_cloud_model( loaded_model_id ) ) await unload_model()
        if( is_cloud_model( localStorage.getItem( storage_key( `active_model_id` ) ) ) ) localStorage.removeItem( storage_key( `active_model_id` ) )

        await sign_out()
        set( { signed_in: false, usage: null } )

    },

    /** Re-read the session and allowance (after sign-in, on opening Pro surfaces) */
    refresh: async () => {

        const signed_in = is_signed_in()
        set( { signed_in } )
        if( !signed_in || !get().available ) return

        try {
            const response = await gratis_fetch( `/v1/usage` )
            if( response.ok ) set( { usage: await response.json() } )
        } catch ( err ) {
            log.warn( `[pro] Could not read usage:`, err.message )
            set( { signed_in: is_signed_in() } )
        }

    },

} ) )

export default use_pro_store
