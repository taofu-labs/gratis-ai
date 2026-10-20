import { useEffect } from 'react'

const FOCUSABLE = [
    `a[href]`, `button:not([disabled])`, `input:not([disabled])`,
    `select:not([disabled])`, `textarea:not([disabled])`, `[tabindex]:not([tabindex="-1"])`,
].join( `,` )

/**
 * Modal focus management: focus moves in on open, Tab cycles inside,
 * the app behind goes inert, and focus returns to the opener on close.
 * The dialog must render outside #root (portal) so inert does not hit it.
 * @param {React.RefObject<HTMLElement>} ref - Dialog element
 * @param {boolean} is_open - Whether the dialog is shown
 */
export default function use_dialog_focus( ref, is_open ) {

    useEffect( () => {

        if( !is_open || !ref.current ) return

        const dialog = ref.current
        const opener = document.activeElement
        const app_root = document.getElementById( `root` )

        // Hide the app from keyboard, pointer and screen readers
        if( app_root ) app_root.inert = true

        // Prefer the first focusable control, else the dialog itself
        const focusables = () => [ ...dialog.querySelectorAll( FOCUSABLE ) ]
            .filter( ( el ) => el.getClientRects().length > 0 )
        ;( focusables()[ 0 ] || dialog ).focus()

        // Wrap Tab / Shift+Tab at the edges
        const handle_keydown = ( e ) => {

            if( e.key !== `Tab` ) return

            const items = focusables()
            if( !items.length ) return e.preventDefault()

            const [ first ] = items
            const last = items.at( -1 )
            const outside = !dialog.contains( document.activeElement )

            if( e.shiftKey && ( document.activeElement === first || outside ) ) {
                e.preventDefault()
                last.focus()
            } else if( !e.shiftKey && ( document.activeElement === last || outside ) ) {
                e.preventDefault()
                first.focus()
            }

        }

        document.addEventListener( `keydown`, handle_keydown )

        return () => {
            document.removeEventListener( `keydown`, handle_keydown )
            if( app_root ) app_root.inert = false
            if( opener?.isConnected ) opener.focus()
        }

    }, [ is_open, ref ] )

}
