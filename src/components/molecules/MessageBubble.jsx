import { memo, useState, useRef, useEffect } from 'react'
import styled, { keyframes } from 'styled-components'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Copy, Check, ChevronRight, LoaderCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import StreamingIndicator from '../atoms/StreamingIndicator'
import WakingUpIndicator from '../atoms/WakingUpIndicator'
import GenerationStats from '../atoms/GenerationStats'
import SlowDeviceWarning from '../atoms/SlowDeviceWarning'
import MessageActions from './MessageActions'
import { render_emoji_text } from '../../utils/emoji_text'


/**
 * Extract <think>...</think> blocks from model output.
 * Some models (Qwen3, DeepSeek-R1 distills) emit thinking tokens
 * before their actual response — we surface these in a collapsible block.
 */
const parse_thinking = ( content, is_streaming ) => {

    // Completed think block — closing tag present
    const closed = content.match( /^<think>([\s\S]*?)<\/think>\s*([\s\S]*)$/ )

    if( closed ) {
        const thinking = closed[1].trim()
        const has_content = thinking.replace( /\s/g, `` ).length > 1
        return {
            thinking: has_content ? thinking : null,
            response: closed[2],
            is_thinking: false,
        }
    }

    // Still streaming inside a think block (no closing tag yet)
    if( is_streaming && content.startsWith( `<think>` ) ) {
        const thinking = content.slice( 7 ).trim()
        const has_content = thinking.replace( /\s/g, `` ).length > 1
        return {
            thinking: has_content ? thinking : null,
            response: ``,
            is_thinking: true,
        }
    }

    // Finished streaming with an unclosed <think> — strip the superfluous prefix
    if( !is_streaming && content.startsWith( `<think>` ) ) {
        return { thinking: null, response: content.slice( 7 ).trimStart(), is_thinking: false }
    }

    // No think block at all — pass through unchanged
    return { thinking: null, response: content, is_thinking: false }

}

const BubbleContainer = styled.div`
    display: flex;
    flex-direction: column;
    align-self: ${ ( { $is_user } ) => $is_user ? `flex-end` : `flex-start` };
    max-width: 85%;
    position: relative;

    &:hover .message-actions {
        opacity: 1;
    }
`

const Bubble = styled.div`
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } 0` };
    background: transparent;
    line-height: 1.5;
    word-wrap: break-word;
    overflow-wrap: break-word;
    max-width: 65ch;

    /* Markdown styling */
    p { margin: 0 0 0.5em 0; }
    p:last-child { margin-bottom: 0; }
    ul, ol { margin: 0.5em 0; padding-left: 1.5em; }
    code {
        font-family: ${ ( { theme } ) => theme.fonts.mono };
        font-size: 0.85em;
        background: ${ ( { theme } ) => theme.colors.code_background };
        padding: 0.1em 0.3em;
        border-radius: ${ ( { theme } ) => theme.border_radius.sm };
    }
    pre {
        position: relative;
        background: ${ ( { theme } ) => theme.colors.code_background };
        border-radius: ${ ( { theme } ) => theme.border_radius.md };
        padding: ${ ( { theme } ) => theme.spacing.md };
        overflow-x: auto;
        margin: 0.5em 0;
    }
    pre code {
        background: none;
        padding: 0;
    }
    blockquote {
        border-left: 2px solid ${ ( { theme } ) => theme.colors.border };
        padding-left: ${ ( { theme } ) => theme.spacing.md };
        margin: 0.5em 0;
        color: ${ ( { theme } ) => theme.colors.text_secondary };
    }
`

const EditContainer = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    width: 100%;
`

const EditTextarea = styled.textarea`
    width: 100%;
    min-height: 80px;
    padding: ${ ( { theme } ) => theme.spacing.md };
    background: ${ ( { theme } ) => theme.colors.input_background };
    color: ${ ( { theme } ) => theme.colors.text };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    resize: vertical;
    font-family: inherit;
    font-size: 0.9rem;
    line-height: 1.5;
`

const EditActions = styled.div`
    display: flex;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    justify-content: flex-end;
`

const EditButton = styled.button`
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } ${ theme.spacing.md }` };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    font-size: 0.85rem;
    transition: opacity 0.15s;
`

const SubmitButton = styled( EditButton )`
    background: ${ ( { theme } ) => theme.colors.accent };
    color: white;
    &:hover { opacity: 0.85; }
`

const CancelButton = styled( EditButton )`
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    &:hover { color: ${ ( { theme } ) => theme.colors.text }; }
`

const CodeCopyButton = styled.button`
    position: absolute;
    top: ${ ( { theme } ) => theme.spacing.sm };
    right: ${ ( { theme } ) => theme.spacing.sm };
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: ${ ( { theme } ) => theme.border_radius.sm };
    color: ${ ( { theme } ) => theme.colors.text_muted };
    opacity: 0;
    transition: opacity 0.15s;

    pre:hover & { opacity: 1; }
    &:hover { color: ${ ( { theme } ) => theme.colors.text }; }
`

// --- Thinking block styles ---

const spin = keyframes`
    to { transform: rotate( 360deg ); }
`

const ThinkingSpinner = styled( LoaderCircle )`
    animation: ${ spin } 1s linear infinite;
    flex-shrink: 0;
`

const ThinkingHeader = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    font-size: 0.8rem;
    font-weight: 600;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    margin-bottom: ${ ( { theme } ) => theme.spacing.xs };
`

const ThinkingToggle = styled.button`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    font-size: 0.75rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } 0` };
    transition: color 0.15s;

    &:hover { color: ${ ( { theme } ) => theme.colors.text_secondary }; }

    svg {
        transition: transform 0.2s ease;
        transform: rotate( ${ ( { $expanded } ) => $expanded ? `90deg` : `0deg` } );
    }
`

const ThinkingPanel = styled.div`
    overflow: hidden;
    max-height: ${ ( { $expanded } ) => $expanded ? `2000px` : `0px` };
    opacity: ${ ( { $expanded } ) => $expanded ? 1 : 0 };
    visibility: ${ ( { $expanded } ) => $expanded ? `visible` : `hidden` };
    transition: max-height 0.3s ease, opacity 0.2s ease, visibility 0.3s ease;

    @media ( prefers-reduced-motion: reduce ) {
        transition: none;
    }
`

const ThinkingContent = styled.div`
    border-left: 2px solid ${ ( { theme } ) => theme.colors.border };
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.md }` };
    margin-bottom: ${ ( { theme } ) => theme.spacing.sm };
    font-size: 0.82rem;
    line-height: 1.5;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    white-space: pre-wrap;
    word-wrap: break-word;
`

// Truncated view — shows only the last 5 lines during streaming
const VISIBLE_LINES = 5
const LINE_HEIGHT_EM = 1.5
const FONT_SIZE_REM = 0.82

const ThinkingWindow = styled.div`
    border-left: 2px solid ${ ( { theme } ) => theme.colors.border };
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.md }` };
    margin-bottom: ${ ( { theme } ) => theme.spacing.sm };
    font-size: ${ FONT_SIZE_REM }rem;
    line-height: ${ LINE_HEIGHT_EM };
    color: ${ ( { theme } ) => theme.colors.text_muted };
    white-space: pre-wrap;
    word-wrap: break-word;

    /* When not expanded, clip to N visible lines — JS pins scroll to bottom */
    ${ ( { $expanded } ) => !$expanded && `
        max-height: calc( ${ VISIBLE_LINES } * ${ LINE_HEIGHT_EM }em * ${ FONT_SIZE_REM } + 0.5rem );
        overflow-y: auto;

        /* Hide scrollbar so it looks like a clean window */
        scrollbar-width: none;
        &::-webkit-scrollbar { display: none; }
    ` }
`

const ExpandButton = styled.button`
    font-size: 0.75rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } 0` };
    transition: color 0.15s;

    &:hover { color: ${ ( { theme } ) => theme.colors.text_secondary }; }
`


/**
 * Custom pre component with copy button for code blocks
 */
const CodeBlock = ( { children, ...props } ) => {

    const { t } = useTranslation()
    const [ copied, set_copied ] = useState( false )

    const handle_copy = async () => {
        const code = children?.props?.children || ``
        try {
            await navigator.clipboard.writeText( code )
            set_copied( true )
            setTimeout( () => set_copied( false ), 2000 )
        } catch {
            toast.error( t( `common:failed_to_copy_code` ) )
        }
    }

    return <pre { ...props }>
        { children }
        <CodeCopyButton onClick={ handle_copy } aria-label={ t( `common:aria_copy_code` ) }>
            { copied ? <Check size={ 14 } /> : <Copy size={ 14 } /> }
        </CodeCopyButton>
    </pre>

}

/**
 * Individual message bubble with markdown rendering and actions
 * @param {Object} props
 * @param {Object} props.message - Message object
 * @param {boolean} props.is_streaming - Whether this message is currently streaming
 * @param {boolean} props.is_last_assistant - Whether this is the last assistant message
 * @param {Function} props.on_regenerate - Regenerate handler
 * @param {Function} props.on_edit - Edit handler
 * @returns {JSX.Element}
 */
const MessageBubble = memo( ( {
    message,
    is_streaming,
    is_endpoint_warming,
    is_cloud_model,
    is_last_assistant,
    on_regenerate,
    on_edit,
} ) => {

    const { t } = useTranslation( `chat` )
    const is_user = message.role === `user`
    const [ is_editing, set_is_editing ] = useState( false )
    const [ edit_text, set_edit_text ] = useState( message.content )
    const [ show_thinking, set_show_thinking ] = useState( false )
    const [ thinking_expanded, set_thinking_expanded ] = useState( false )
    const thinking_ref = useRef( null )

    // Parse thinking blocks from assistant messages
    const { thinking, response, is_thinking } = is_user
        ? { thinking: null, response: message.content, is_thinking: false }
        : parse_thinking( message.content, is_streaming )
    const display_thinking = render_emoji_text( thinking )
    const display_response = render_emoji_text( response )

    // Count lines to decide whether truncation is needed
    const thinking_lines = thinking ? thinking.split( `\n` ).length : 0
    const needs_truncation = thinking_lines > VISIBLE_LINES

    // Auto-scroll the thinking window to bottom as new lines stream in
    useEffect( () => {
        if( is_thinking && !thinking_expanded && thinking_ref.current ) {
            thinking_ref.current.scrollTop = thinking_ref.current.scrollHeight
        }
    }, [ thinking, is_thinking, thinking_expanded ] )

    const handle_edit_submit = () => {
        if( on_edit && edit_text.trim() ) {
            on_edit( edit_text.trim() )
            set_is_editing( false )
        }
    }

    const handle_edit_cancel = () => {
        set_edit_text( message.content )
        set_is_editing( false )
    }

    const testid = is_user ? `user-message` : `assistant-message`

    return <BubbleContainer $is_user={ is_user }>

        <MessageActions
            content={ message.content }
            can_regenerate={ !is_user && is_last_assistant && !is_streaming }
            can_edit={ is_user && !is_streaming }
            on_regenerate={ on_regenerate }
            on_edit={ () => set_is_editing( true ) }
        />

        { is_editing ?
            <EditContainer>
                <EditTextarea
                    data-testid="message-edit-textarea"
                    value={ edit_text }
                    onChange={ ( e ) => set_edit_text( e.target.value ) }
                    autoFocus
                />
                <EditActions>
                    <CancelButton
                        data-testid="message-edit-cancel"
                        onClick={ handle_edit_cancel }
                    >
                        { t( `common:cancel` ) }
                    </CancelButton>
                    <SubmitButton
                        data-testid="message-edit-submit"
                        onClick={ handle_edit_submit }
                    >
                        { t( `common:submit` ) }
                    </SubmitButton>
                </EditActions>
            </EditContainer>
            :
            <Bubble data-testid={ testid } $is_user={ is_user }>

                { /* Thinking block — truncated window while streaming, collapsed when done */ }
                { thinking && is_thinking && <>
                    <ThinkingHeader>
                        <ThinkingSpinner size={ 14 } />
                        { t( `thinking` ) }
                    </ThinkingHeader>
                    <ThinkingWindow
                        ref={ thinking_ref }
                        $expanded={ thinking_expanded }
                        data-testid="thinking-content"
                    >
                        { display_thinking }
                    </ThinkingWindow>
                    { needs_truncation && !thinking_expanded &&
                        <ExpandButton onClick={ () => set_thinking_expanded( true ) }>
                            { t( `show_all_thinking` ) }
                        </ExpandButton> }
                    { thinking_expanded &&
                        <ExpandButton onClick={ () => set_thinking_expanded( false ) }>
                            { t( `collapse` ) }
                        </ExpandButton> }
                </> }

                { /* Thinking complete — collapsible toggle */ }
                { thinking && !is_thinking && <>
                    <ThinkingToggle
                        data-testid="thinking-toggle"
                        $expanded={ show_thinking }
                        onClick={ () => set_show_thinking( !show_thinking ) }
                    >
                        <ChevronRight size={ 14 } />
                        { show_thinking ? t( `hide_thinking` ) : t( `show_thinking` ) }
                    </ThinkingToggle>
                    <ThinkingPanel $expanded={ show_thinking }>
                        <ThinkingContent data-testid="thinking-content">
                            { display_thinking }
                        </ThinkingContent>
                    </ThinkingPanel>
                </> }

                { /* Main response content */ }
                { display_response && <ReactMarkdown
                    remarkPlugins={ [ remarkGfm ] }
                    rehypePlugins={ [ rehypeHighlight ] }
                    components={ { pre: CodeBlock } }
                >
                    { display_response }
                </ReactMarkdown> }

                { /* Streaming indicator — waking up before first token, cursor after */ }
                { is_streaming && !is_thinking && (
                    response ? <StreamingIndicator /> : <WakingUpIndicator show_hint={ is_cloud_model } />
                ) }

            </Bubble> }

        { /* Generation stats for completed assistant messages */ }
        { !is_user && !is_streaming && message.stats &&
            <GenerationStats stats={ message.stats } /> }

        { /* Slow device nudge — web-only, once per session */ }
        { !is_user && !is_streaming && message.stats &&
            <SlowDeviceWarning tokens_per_second={ message.stats.tokens_per_second } /> }

    </BubbleContainer>

} )

export default MessageBubble
