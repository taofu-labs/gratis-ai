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

            // Pinch zoom shrinks the visual viewport too; scale it back out so only the keyboard counts
            document.documentElement.style.setProperty( `--app-height`, `${ viewport.height * viewport.scale }px` )

            // Undo the keyboard pan at once (html scrolls smoothly), but leave a zoomed-in user free to pan
            if( window.scrollY && viewport.scale < 1.01 ) window.scrollTo( { top: 0, behavior: `instant` } )

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
