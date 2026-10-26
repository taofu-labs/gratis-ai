import { useRef, useEffect, useCallback } from 'react'
import styled from 'styled-components'
import MessageBubble from './MessageBubble'

const ListContainer = styled.div`
    flex: 1;
    overflow-y: auto;
    padding: ${ ( { theme } ) => theme.spacing.lg };
    display: flex;
    flex-direction: column;
    gap: ${ ( { theme } ) => theme.spacing.md };
    max-width: 65ch;
    width: 100%;
    margin: 0 auto;
    padding-inline: ${ ( { theme } ) => theme.spacing.md };
`

/**
 * Scrollable message list with auto-scroll during streaming
 * @param {Object} props
 * @param {Array} props.messages - Array of message objects
 * @param {boolean} props.is_streaming - Whether currently streaming
 * @param {boolean} props.is_endpoint_warming - Whether the cloud endpoint is still spinning up
 * @param {boolean} props.is_cloud_model - Whether the active model is a cloud model
 * @param {Function} props.on_regenerate - Regenerate last response
 * @param {Function} props.on_edit - Edit and resend a message
 * @param {Object|null} [props.speed_tip] - Inline speed offer for the latest reply (see SpeedTip)
 * @returns {JSX.Element}
 */
export default function MessageList( { messages, is_streaming, is_endpoint_warming, is_cloud_model, on_regenerate, on_edit, speed_tip } ) {

    const list_ref = useRef( null )
    const stick_to_bottom = useRef( true )

    // Parent handlers change on every streamed token. Stable wrappers keep the
    // memoized bubbles from re-parsing markdown for the whole chat per token.
    const handlers = useRef( { on_regenerate, on_edit } )
    handlers.current = { on_regenerate, on_edit }
    const stable_regenerate = useCallback( ( ...args ) => handlers.current.on_regenerate?.( ...args ), [] )
    const stable_edit = useCallback( ( ...args ) => handlers.current.on_edit?.( ...args ), [] )

    // Follow the stream only while the reader is already at the bottom, so
    // scrolling up to re-read is not yanked back down by every token
    const handle_scroll = useCallback( () => {
        const list = list_ref.current
        if( !list ) return
        stick_to_bottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80
    }, [] )

    // A newly sent message always snaps back to the bottom
    const message_count = messages.length
    useEffect( () => {
        stick_to_bottom.current = true
    }, [ message_count ] )

    useEffect( () => {

        const list = list_ref.current
        if( list && stick_to_bottom.current ) list.scrollTop = list.scrollHeight

    }, [ messages, is_streaming ] )

    // Find the last assistant message index for regenerate action
    const last_assistant_index = messages.reduce( ( acc, msg, idx ) =>
        msg.role === `assistant` ? idx : acc, -1
    )

    return <ListContainer ref={ list_ref } onScroll={ handle_scroll }>

        { messages.map( ( message, index ) =>
            <MessageBubble
                key={ message.id || index }
                message={ message }
                is_streaming={ is_streaming && index === messages.length - 1 && message.role === `assistant` }
                is_busy={ is_streaming }
                is_endpoint_warming={ is_endpoint_warming }
                is_cloud_model={ is_cloud_model }
                is_last_assistant={ index === last_assistant_index }
                speed_tip={ index === last_assistant_index ? speed_tip : null }
                index={ index }
                on_regenerate={ stable_regenerate }
                on_edit={ stable_edit }
            />
        ) }

    </ListContainer>

}
