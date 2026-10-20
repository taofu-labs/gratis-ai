import styled from 'styled-components'
import { Copy, RefreshCw, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

const ActionsBar = styled.div`
    display: flex;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    opacity: 0;
    transition: opacity 0.15s;
    position: absolute;
    top: -28px;
    right: 0;

    /* Keyboard users reach the actions without hovering */
    &:focus-within { opacity: 1; }

    /* Touch has no hover: dock the bar under the bubble, always visible */
    @media ${ ( { theme } ) => theme.media.touch } {
        position: static;
        order: 1;
        opacity: 1;
        gap: 0;
        justify-content: flex-end;
        margin-right: -0.5rem;
    }
`

const ActionButton = styled.button`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: ${ ( { theme } ) => theme.border_radius.sm };
    color: ${ ( { theme } ) => theme.colors.text_muted };
    opacity: 0.5;
    transition: opacity 0.15s;

    &:hover, &:focus-visible {
        opacity: 1;
        color: ${ ( { theme } ) => theme.colors.text };
    }

    @media ${ ( { theme } ) => theme.media.touch } {
        width: 2.75rem;
        height: 2.75rem;
        opacity: 0.8;
    }
`

/**
 * Hover action bar for messages (copy, regenerate, edit)
 * @param {Object} props
 * @param {string} props.content - Message text content
 * @param {boolean} props.can_regenerate - Show regenerate button
 * @param {boolean} props.can_edit - Show edit button
 * @param {Function} props.on_regenerate - Regenerate handler
 * @param {Function} props.on_edit - Edit handler
 * @returns {JSX.Element}
 */
export default function MessageActions( { content, can_regenerate, can_edit, on_regenerate, on_edit } ) {

    const { t } = useTranslation()

    const handle_copy = async () => {
        try {
            await navigator.clipboard.writeText( content )
            toast.success( t( `copied_to_clipboard` ) )
        } catch {
            toast.error( t( `failed_to_copy` ) )
        }
    }

    return <ActionsBar className="message-actions">
        <ActionButton
            data-testid="message-copy-btn"
            onClick={ handle_copy }
            aria-label={ t( `aria_copy_message` ) }
        >
            <Copy size={ 14 } />
        </ActionButton>

        { can_regenerate && <ActionButton
            data-testid="message-regenerate-btn"
            onClick={ on_regenerate }
            aria-label={ t( `aria_regenerate_response` ) }
        >
            <RefreshCw size={ 14 } />
        </ActionButton> }

        { can_edit && <ActionButton
            data-testid="message-edit-btn"
            onClick={ on_edit }
            aria-label={ t( `aria_edit_message` ) }
        >
            <Pencil size={ 14 } />
        </ActionButton> }
    </ActionsBar>

}
