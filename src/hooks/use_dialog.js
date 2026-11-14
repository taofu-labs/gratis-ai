import { useEffect, useId, useRef } from 'react'
import { flushSync } from 'react-dom'
import use_dialog_focus from './use_dialog_focus'
import { EVENTS } from '../utils/branding'

/**
 * Everything a modal needs to be a real dialog, in one place: dialog role,
 * aria-modal, a name from its title, focus trap + restore (use_dialog_focus),
 * Escape and backdrop click to close.
 *
 * Render the overlay through createPortal( …, document.body ): the app root
 * goes inert while the dialog is open, and a dialog inside it would go inert too.
 *
 * @example
 * const { title_id, overlay_props, dialog_props } = use_dialog( { is_open, on_close } )
 * return createPortal( <Overlay { ...overlay_props }>
 *     <Panel { ...dialog_props }><Title id={ title_id }>…</Title></Panel>
 * </Overlay>, document.body )
 *
 * @param {Object} options
 * @param {boolean} options.is_open - Whether the dialog is shown
 * @param {Function} options.on_close - Called on Escape or backdrop click
 * @param {boolean} [options.dismissable=true] - False ignores Escape and backdrop clicks (e.g. mid-download)
 * @param {React.RefObject<HTMLElement>} [options.initial_focus] - Control to focus on open, defaults to the first one
 * @returns {{ title_id: string, overlay_props: Object, dialog_props: Object }}
 */
export default function use_dialog( { is_open, on_close, dismissable = true, initial_focus } ) {

    const dialog_ref = useRef( null )
    const title_id = useId()

    use_dialog_focus( dialog_ref, is_open, initial_focus )

    // Escape arrives as the app-wide close event (utils/keyboard_shortcuts).
    // Close within the keypress: the app stays inert until this commits,
    // so a deferred close would drop input typed right after Escape.
    useEffect( () => {

        if( !is_open || !dismissable ) return

        const handle_close = () => flushSync( on_close )
        window.addEventListener( EVENTS.close_modal, handle_close )
        return () => window.removeEventListener( EVENTS.close_modal, handle_close )

    }, [ is_open, dismissable, on_close ] )

    // Clicks on the backdrop itself close, clicks inside the panel do not
    const overlay_props = {
        onClick: ( e ) => {
            if( dismissable && e.target === e.currentTarget ) on_close()
        },
    }

    // Spread onto the panel; its title must carry title_id to name the dialog
    const dialog_props = {
        ref: dialog_ref,
        role: `dialog`,
        'aria-modal': `true`,
        'aria-labelledby': title_id,
    }

    return { title_id, overlay_props, dialog_props }

}
