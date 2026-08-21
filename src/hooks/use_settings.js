import { useState, useCallback, useEffect } from 'react'
import { log } from 'mentie'
import { EVENTS, STORAGE_PREFIX } from '../utils/branding'

// Default values for all settings
const DEFAULTS = {
    temperature: 0.7,
    max_tokens: 2048,
    system_prompt: ``,
    top_p: 0.95,
    top_k: 40,
    min_p: 0.05,
    repeat_penalty: 1.1,
    repeat_last_n: 64,
    frequency_penalty: 0,
    presence_penalty: 0,
    seed: -1,
    stop_sequences: ``,
}

const PREFIX = STORAGE_PREFIX

/**
 * Read a setting from localStorage with fallback to default
 * @param {string} key - Setting key (without prefix)
 * @param {*} default_value - Default value if not found
 * @returns {*} The setting value
 */
const read_setting = ( key, default_value ) => {
    const stored = localStorage.getItem( `${ PREFIX }${ key }` )
    if( stored === null ) return default_value
    const num = Number( stored )
    return isNaN( num ) ? stored : num
}

/**
 * Hook for reading and writing settings from localStorage
 * @returns {Object} Settings state and setters
 */
export default function use_settings() {

    const [ settings, set_settings ] = useState( () => {

        // Initialise from localStorage with defaults
        const initial = {}
        for( const [ key, default_value ] of Object.entries( DEFAULTS ) ) {
            initial[ key ] = read_setting( key, default_value )
        }

        // System prompt defaults from env var
        if( !initial.system_prompt ) {
            initial.system_prompt = import.meta.env.VITE_DEFAULT_SYSTEM_PROMPT || ``
        }

        return initial

    } )

    /**
     * Update a single setting — persists to localStorage
     * @param {string} key - Setting key
     * @param {*} value - New value
     */
    const update_setting = useCallback( ( key, value ) => {

        localStorage.setItem( `${ PREFIX }${ key }`, String( value ) )
        log.debug( `[settings] ${ key } = ${ value }` )
        set_settings( ( prev ) => ( { ...prev, [ key ]: value } ) )
        window.dispatchEvent( new CustomEvent( EVENTS.settings_changed, {
            detail: { key, value },
        } ) )

    }, [] )

    /**
     * Build GenerateOptions object from current settings
     * @returns {import('../providers/types').GenerateOptions}
     */
    const get_generate_options = useCallback( () => {

        // Parse comma-separated stop sequences into an array
        const stop = settings.stop_sequences
            ? settings.stop_sequences.split( `,` ).map( s => s.trim() ).filter( Boolean )
            : undefined

        return {
            temperature: settings.temperature,
            max_tokens: settings.max_tokens,
            top_p: settings.top_p,
            top_k: settings.top_k,
            min_p: settings.min_p,
            repeat_penalty: settings.repeat_penalty,
            repeat_last_n: settings.repeat_last_n,
            frequency_penalty: settings.frequency_penalty,
            presence_penalty: settings.presence_penalty,
            seed: settings.seed === -1 ? undefined : settings.seed,
            ... stop?.length ? { stop_sequences: stop } : {} ,
        }

    }, [ settings ] )

    // localStorage's `storage` event only fires in other documents. SettingsModal
    // and ChatPage mount separate hook instances, so also synchronize changes
    // within this window through an app event.
    useEffect( () => {

        const handle_storage = ( e ) => {
            if( e.key?.startsWith( PREFIX ) ) {
                const setting_key = e.key.slice( PREFIX.length )
                if( setting_key in DEFAULTS ) {
                    log.debug( `[settings] Cross-tab sync: ${ setting_key }` )
                    const val = e.newValue === null ? DEFAULTS[ setting_key ] :  isNaN( Number( e.newValue ) ) ? e.newValue : Number( e.newValue )
                    set_settings( ( prev ) => ( { ...prev, [ setting_key ]: val } ) )
                }
            }
        }

        const handle_local_change = ( { detail } ) => {
            if( detail?.key && detail.key in DEFAULTS ) {
                set_settings( ( prev ) => ( { ...prev, [ detail.key ]: detail.value } ) )
            }
        }

        window.addEventListener( `storage`, handle_storage )
        window.addEventListener( EVENTS.settings_changed, handle_local_change )
        return () => {
            window.removeEventListener( `storage`, handle_storage )
            window.removeEventListener( EVENTS.settings_changed, handle_local_change )
        }

    }, [] )

    return {
        settings,
        update_setting,
        get_generate_options,
    }

}
