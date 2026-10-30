import { useEffect } from 'react'

/**
 * Keeps the app inside the part of the screen the touch keyboard leaves free.
 * Chrome on Android resizes the layout itself (`interactive-widget=resizes-content` in index.html);
 * iOS Safari only shrinks the visual viewport and pans the page under it, hiding the top bar.
 * So: size the app to the visual viewport (`--app-height`, read by GlobalStyle) and undo the pan.
 */
export default function use_viewport_height() {

    useEffect( () => {

        const viewport = window.visualViewport
        if( !viewport ) return

        const sync = () => {

            // Pinch zoom also shrinks the visual viewport; only follow the keyboard
            if( viewport.scale > 1.01 ) return

            document.documentElement.style.setProperty( `--app-height`, `${ viewport.height }px` )
            if( window.scrollY ) window.scrollTo( 0, 0 )

        }

        sync()
        viewport.addEventListener( `resize`, sync )
        viewport.addEventListener( `scroll`, sync )
        return () => {
            viewport.removeEventListener( `resize`, sync )
            viewport.removeEventListener( `scroll`, sync )
        }

    }, [] )

}
