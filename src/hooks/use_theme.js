import { useEffect } from 'react'
import { dark_theme } from '../styles/theme'
import { storage_key } from '../utils/branding'

const STORAGE_KEY = storage_key( `theme` )

/**
 * Hook for dark-only theme management.
 * @returns {{ theme: Object }}
 */
export default function use_theme() {

    useEffect( () => {

        try {
            localStorage.setItem( STORAGE_KEY, `dark` )
        } catch {
            // localStorage unavailable
        }

        let meta = document.querySelector( `meta[name="theme-color"]` )
        if( !meta ) {
            meta = document.createElement( `meta` )
            meta.setAttribute( `name`, `theme-color` )
            document.head.appendChild( meta )
        }
        meta.setAttribute( `content`, dark_theme.colors.background )

    }, [] )

    return { theme: dark_theme }

}
