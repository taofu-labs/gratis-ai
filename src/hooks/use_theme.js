import { useEffect, useState } from 'react'
import { dark_theme, light_theme } from '../styles/theme'

const dark_query = typeof window !== `undefined` && window.matchMedia?.( `( prefers-color-scheme: dark )` )

/**
 * Follows the device colour scheme, live: paper by day, deep blue by night.
 * @returns {{ theme: Object }}
 */
export default function use_theme() {

    const [ is_dark, set_dark ] = useState( !!dark_query?.matches )

    // Track the OS switching schemes while the app is open
    useEffect( () => {

        if( !dark_query ) return
        const on_change = ( { matches } ) => set_dark( matches )
        dark_query.addEventListener( `change`, on_change )
        return () => dark_query.removeEventListener( `change`, on_change )

    }, [] )

    const theme = is_dark ? dark_theme : light_theme

    // Browser chrome and the PWA title bar match the page
    useEffect( () => {

        let meta = document.querySelector( `meta[name="theme-color"]:not([media])` )
        if( !meta ) {
            meta = document.createElement( `meta` )
            meta.setAttribute( `name`, `theme-color` )
            document.head.appendChild( meta )
        }
        meta.setAttribute( `content`, theme.colors.background )

    }, [ theme ] )

    return { theme }

}
