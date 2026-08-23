import { useState, useEffect, useCallback, useMemo } from 'react'
import { dark_theme, light_theme } from '../styles/theme'
import { storage_key } from '../utils/branding'

const STORAGE_KEY = storage_key( `theme` )

/**
 * Hook for theme management with system detection and persistence
 * @returns {{ theme: Object, theme_preference: string, set_theme_preference: Function }}
 */
export default function use_theme() {

    // Read stored preference, defaulting to 'system'
    const [ theme_preference, set_preference ] = useState( () => {
        try {
            return localStorage.getItem( STORAGE_KEY ) || `system`
        } catch {
            return `system`
        }
    } )

    // Track system dark mode preference
    const [ system_is_dark, set_system_is_dark ] = useState( () => {
        if( typeof window === `undefined` ) return true
        return window.matchMedia( `(prefers-color-scheme: dark)` ).matches
    } )

    // Listen for OS theme changes
    useEffect( () => {

        const media_query = window.matchMedia( `(prefers-color-scheme: dark)` )
        const handler = ( e ) => set_system_is_dark( e.matches )

        media_query.addEventListener( `change`, handler )
        return () => media_query.removeEventListener( `change`, handler )

    }, [] )

    // Resolve the actual theme based on preference
    const theme = useMemo( () => {

        if( theme_preference === `light` ) return light_theme
        if( theme_preference === `dark` ) return dark_theme
        return system_is_dark ? dark_theme : light_theme

    }, [ theme_preference, system_is_dark ] )

    // Update meta theme-color and color-scheme when theme changes
    useEffect( () => {

        // Update meta theme-color
        let meta = document.querySelector( `meta[name="theme-color"]` )
        if( !meta ) {
            meta = document.createElement( `meta` )
            meta.setAttribute( `name`, `theme-color` )
            document.head.appendChild( meta )
        }
        meta.setAttribute( `content`, theme.colors.background )

    }, [ theme ] )

    // Persist preference to localStorage
    const set_theme_preference = useCallback( ( preference ) => {

        set_preference( preference )
        try {
            localStorage.setItem( STORAGE_KEY, preference )
        } catch {
            // localStorage unavailable
        }

    }, [] )

    return { theme, theme_preference, set_theme_preference }

}
