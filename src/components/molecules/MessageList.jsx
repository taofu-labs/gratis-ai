import { useRef, useEffect } from 'react'
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
 * @returns {JSX.Element}
 */
export default function MessageList( { messages, is_streaming, is_endpoint_warming, is_cloud_model, on_regenerate, on_edit } ) {

    const list_ref = useRef( null )

    // Auto-scroll to bottom during streaming and when new messages appear
    useEffect( () => {

        if( list_ref.current ) {
            list_ref.current.scrollTop = list_ref.current.scrollHeight
        }

    }, [ messages, is_streaming ] )

    // Find the last assistant message index for regenerate action
    const last_assistant_index = messages.reduce( ( acc, msg, idx ) =>
        msg.role === `assistant` ? idx : acc, -1
    )

    return <ListContainer ref={ list_ref }>

        { messages.map( ( message, index ) =>
            <MessageBubble
                key={ message.id || index }
                message={ message }
                is_streaming={ is_streaming && index === messages.length - 1 && message.role === `assistant` }
                is_endpoint_warming={ is_endpoint_warming }
                is_cloud_model={ is_cloud_model }
                is_last_assistant={ index === last_assistant_index }
                on_regenerate={ on_regenerate }
                on_edit={ ( new_text ) => on_edit( index, new_text ) }
            />
        ) }

    </ListContainer>

}
