import { useLayoutEffect } from 'react'

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

    // Layout effect: inert must lift in the same commit that closes the dialog,
    // or input typed right after Esc lands on a still-inert page and is dropped
    useLayoutEffect( () => {

        if( !is_open || !ref.current ) return

        const dialog = ref.current
        const opener = document.activeElement
        const app_root = document.getElementById( `root` )

        // Hide the app from keyboard, pointer and screen readers
        if( app_root ) app_root.inert = true

        // Prefer the first focusable control, else the dialog itself. Collapsed
        // panels use visibility:hidden, which keeps layout boxes but not focus.
        const is_reachable = ( el ) => el.checkVisibility
            ? el.checkVisibility( { visibilityProperty: true } )
            : el.getClientRects().length > 0 && getComputedStyle( el ).visibility !== `hidden`
        const focusables = () => [ ...dialog.querySelectorAll( FOCUSABLE ) ].filter( is_reachable )
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
            // An opener inside a closed menu is gone; return to the menu trigger instead
            const return_target = opener?.isConnected ? opener : document.querySelector( `[data-focus-fallback]` )
            return_target?.focus()
        }

    }, [ is_open, ref ] )

}
