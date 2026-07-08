import { useState, useEffect, useCallback, useRef } from 'react'
import styled, { keyframes } from 'styled-components'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { v4 as uuid } from 'uuid'
import { log } from 'mentie'
import toast from 'react-hot-toast'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import AppLayout from '../molecules/AppLayout'
import MessageList from '../molecules/MessageList'
import ChatInput from '../molecules/ChatInput'
import VoiceModelDialog from '../molecules/VoiceModelDialog'
import WakingUpIndicator from '../atoms/WakingUpIndicator'
import use_llm from '../../hooks/use_llm'
import use_chat_history from '../../hooks/use_chat_history'
import use_model_manager from '../../hooks/use_model_manager'
import use_settings from '../../hooks/use_settings'
import use_voice_input from '../../hooks/use_voice_input'
import { export_conversation } from '../../utils/export'
import { parse_model_param, resolve_cached_model } from '../../utils/model_param_resolver'
import { get_model_by_id, format_file_size } from '../../utils/model_catalog'
import { useTranslation } from 'react-i18next'
import { storage_key, EVENTS, DISPLAY_NAME, APP_VERSION } from '../../utils/branding'

const Container = styled.div`
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
`

// Wrapper around ChatInput — centers it vertically when no messages,
// then smoothly transitions to bottom-pinned when the user sends a message
const InputSection = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    flex: ${ ( { $centered } ) => $centered ? '1 0 auto' : '0 0 auto' };
    transition: flex-grow 0.4s cubic-bezier( 0.4, 0, 0.2, 1 );
    min-height: 0;
    padding: ${ ( { theme } ) => theme.spacing.md };
    background: ${ ( { theme } ) => theme.colors.background };

    @media ( prefers-reduced-motion: reduce ) {
        transition: none;
    }
`

// Welcome text + suggestions that collapse when the first message is sent
const WelcomeContent = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    overflow: hidden;
    max-height: ${ ( { $visible } ) => $visible ? '500px' : '0' };
    opacity: ${ ( { $visible } ) => $visible ? 1 : 0 };
    margin-bottom: ${ ( { $visible, theme } ) => $visible ? theme.spacing.xl : '0' };
    transition: max-height 0.4s cubic-bezier( 0.4, 0, 0.2, 1 ),
                opacity 0.25s ease,
                margin-bottom 0.4s cubic-bezier( 0.4, 0, 0.2, 1 );

    @media ( prefers-reduced-motion: reduce ) {
        transition: none;
    }
`

const WelcomeTitle = styled.h1`
    font-size: clamp( 1.5rem, 1.2rem + 1vw, 2rem );
    color: ${ ( { theme } ) => theme.colors.text };
    border-bottom: 3px solid ${ ( { theme } ) => theme.colors.accent };
    margin-bottom: ${ ( { theme } ) => theme.spacing.sm };
`

const PrivacyHint = styled.p`
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    margin-bottom: 2rem;
`


// No model CTA — replaces the old dismissive banner
const NoModelContainer = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: ${ ( { theme } ) => theme.spacing.xl };
    text-align: center;
`

const NoModelTitle = styled.h2`
    font-size: 1.3rem;
    color: ${ ( { theme } ) => theme.colors.text };
    margin-bottom: ${ ( { theme } ) => theme.spacing.sm };
`

const NoModelText = styled.p`
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    margin-bottom: ${ ( { theme } ) => theme.spacing.lg };
    max-width: 400px;
    line-height: 1.5;
`

const SetupButton = styled.button`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    background: ${ ( { theme } ) => theme.colors.accent };
    color: white;
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.lg }` };
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    font-size: 0.95rem;
    font-weight: 600;
    transition: opacity 0.15s;
    min-height: 2.75rem;

    &:hover { opacity: 0.85; }
`

// Loading state while model initializes
const LoadingContainer = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: ${ ( { theme } ) => theme.spacing.xl };
    text-align: center;
`

const LoadingText = styled.p`
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    margin-top: ${ ( { theme } ) => theme.spacing.md };
    font-size: 0.95rem;
`

const spin = keyframes`
    from { transform: rotate( 0deg ); }
    to { transform: rotate( 360deg ); }
`

const SpinnerIcon = styled.div`
    color: ${ ( { theme } ) => theme.colors.accent };
    animation: ${ spin } 1.2s linear infinite;

    @media ( prefers-reduced-motion: reduce ) {
        animation: none;
    }
`



/**
 * Main chat interface page with layout shell
 * @param {Object} props
 * @param {string} props.theme_preference - Current theme preference
 * @param {string} props.theme_mode - Resolved theme mode
 * @param {Function} props.on_theme_toggle - Handler for theme cycling
 * @returns {JSX.Element}
 */
export default function ChatPage( { theme_preference, theme_mode, on_theme_toggle } ) {

    const { id: conversation_id } = useParams()
    const navigate = useNavigate()
    const [ search_params, set_search_params ] = useSearchParams()
    const { t } = useTranslation( 'chat' )

    const [ messages, set_messages ] = useState( [] )
    // Initialize as null = "haven't tried loading yet" to distinguish from "tried and failed"
    const [ model_loaded, set_model_loaded ] = useState( null )
    // Start as null even with a URL param — we validate it exists before accepting it
    const [ current_conversation_id, set_current_conversation_id ] = useState( null )
    const chat_input_ref = useRef( null )
    const is_generating_ref = useRef( false )
    const query_processed_ref = useRef( false )

    const { load_model, chat_stream, abort, is_generating, is_endpoint_warming, is_loading: is_model_loading, loaded_model_id } = use_llm()
    const {
        conversations,
        create_conversation,
        save_message,
        load_messages,
        delete_conversation,
        delete_all_conversations,
        replace_messages,
        refresh,
    } = use_chat_history()
    const {
        cached_models,
        is_loading: is_model_switching,
        refresh_models,
    } = use_model_manager()
    const { settings, get_generate_options } = use_settings()

    // Voice input hook
    const {
        is_model_cached: is_voice_cached,
        is_downloading: is_voice_downloading,
        download_progress: voice_download_progress,
        is_recording,
        is_transcribing,
        is_loading_model: is_voice_loading_model,
        audio_level: voice_audio_level,
        recording_start_time: voice_recording_start_time,
        download_model: download_voice_model,
        start_recording,
        stop_and_transcribe,
    } = use_voice_input()

    // Voice dialog and transcription state
    const [ show_voice_dialog, set_show_voice_dialog ] = useState( false )
    const [ voice_download_error, set_voice_download_error ] = useState( false )
    const [ voice_text, set_voice_text ] = useState( null )

    // Whether the correct model is available for inference.
    // If a different model is pending (e.g. cloud after local), the stale loaded model
    // must not count — otherwise we'd show the chat as ready with the wrong model.
    const pending_model_id = localStorage.getItem( storage_key( `active_model_id` ) )
    const has_model = ( model_loaded === true || !!loaded_model_id )
        && ( !pending_model_id || loaded_model_id === pending_model_id )

    // Whether we're in the process of loading a model (includes the initial mount gap)
    const has_pending_model = !!pending_model_id
    const is_loading_model = is_model_loading ||  model_loaded === null && has_pending_model

    // Try loading the active model on mount.
    // The store deduplicates — if HomePage already started a load, this is a no-op.
    useEffect( () => {

        const active_id = localStorage.getItem( storage_key( `active_model_id` ) )

        // Store already has the correct model loaded — sync local flag
        if( loaded_model_id && loaded_model_id === active_id ) {
            set_model_loaded( true )
            return
        }

        // Store is already loading — wait for it (reactive via Zustand)
        if( is_model_loading ) return

        if( active_id ) {

            log.info( `[ChatPage] Auto-loading saved model: ${ active_id }` )
            load_model( active_id )
                .then( () => set_model_loaded( true ) )
                .catch( ( err ) => {
                    log.error( `[ChatPage] Auto-load failed:`, err.message )
                    set_model_loaded( false )
                    toast.error( err.message || t( 'common:failed_to_load_model' ) )
                } )

        } else {
            // No model configured — transition from null (unknown) to false (no model)
            set_model_loaded( false )
        }

    }, [] )

    // Sync local model_loaded flag when the store finishes loading
    // (e.g. a load started by HomePage completes after ChatPage mounts).
    // Only sync when the loaded model matches the pending target — avoids
    // prematurely marking "loaded" when a stale local model is still in the store.
    useEffect( () => {
        const target = localStorage.getItem( storage_key( `active_model_id` ) )
        if( loaded_model_id && loaded_model_id === target && model_loaded !== true ) {
            set_model_loaded( true )
        }
    }, [ loaded_model_id ] )

    // Listen for global stop-generation shortcut (Ctrl+Shift+Backspace)
    useEffect( () => {

        const handle_stop = () => abort()
        window.addEventListener( EVENTS.stop_generation, handle_stop )
        return () => window.removeEventListener( EVENTS.stop_generation, handle_stop )

    }, [ abort ] )

    // Load conversation messages when navigating to /chat/:id
    useEffect( () => {

        if( conversation_id && conversation_id !== current_conversation_id ) {

            // Validate that the conversation exists before loading messages
            load_messages( conversation_id ).then( ( msgs ) => {

                if( msgs.length === 0 ) {
                    // Conversation not found or empty — redirect to fresh chat
                    toast( t( 'common:conversation_not_found' ) )
                    navigate( `/chat`, { replace: true } )
                    return
                }

                set_current_conversation_id( conversation_id )
                set_messages( msgs.map( ( m ) => ( {
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    stats: m.stats,
                } ) ) )

            } )

        }

        // Reset state when navigating to /chat (no id)
        if( !conversation_id && current_conversation_id ) {
            set_current_conversation_id( null )
            set_messages( [] )
        }

    }, [ conversation_id, current_conversation_id, load_messages, navigate ] )

    // Track is_generating in a ref for stable closures,
    // and re-focus the input when generation completes
    useEffect( () => {

        const was_generating = is_generating_ref.current
        is_generating_ref.current = is_generating

        // Generation just finished — re-focus input for next message
        if( was_generating && !is_generating ) {
            chat_input_ref.current?.focus()
        }

    }, [ is_generating ] )

    // Focus the input when switching conversations or navigating to /chat
    useEffect( () => {
        chat_input_ref.current?.focus()
    }, [ conversation_id ] )

    /**
     * Persist the current messages to IndexedDB
     */
    const persist_messages = useCallback( async ( conv_id, msgs ) => {

        await replace_messages( conv_id, msgs )
        await refresh()

    }, [ replace_messages, refresh ] )

    /**
     * Re-send from existing message history (used by regenerate)
     */
    const send_message_from_history = useCallback( async ( history_msgs, conv_id ) => {

        const assistant_msg = { id: uuid(), role: `assistant`, content: `` }
        const new_messages = [ ...history_msgs, assistant_msg ]
        set_messages( new_messages )

        // Model-specific system prompt takes priority (e.g. uncensored personas),
        // falling back to user settings → env default
        const active_model = get_model_by_id( loaded_model_id )
        const system_prompt = active_model?.system_prompt || settings.system_prompt || ``
        const history = history_msgs.map( ( { role, content } ) => ( { role, content } ) )
        if( system_prompt ) history.unshift( { role: `system`, content: system_prompt } )

        const opts = get_generate_options()

        try {

            const result = await chat_stream( history, opts, ( full_text ) => {
                set_messages( prev => {
                    const updated = [ ...prev ]
                    updated[ updated.length - 1 ] = { ...updated[ updated.length - 1 ], content: full_text }
                    return updated
                } )
            } )

            // Final update with stats
            set_messages( prev => {
                const updated = [ ...prev ]
                updated[ updated.length - 1 ] = {
                    ...updated[ updated.length - 1 ],
                    content: result.text,
                    stats: result.stats,
                }
                // Persist final state
                if( conv_id ) persist_messages( conv_id, updated )
                return updated
            } )

        } catch {
            // Error handling done in use_llm
        }

    }, [ chat_stream, persist_messages, get_generate_options, settings.system_prompt, loaded_model_id ] )

    /**
     * Regenerate the last assistant message
     */
    const handle_regenerate = useCallback( () => {

        set_messages( prev => {
            const without_last_assistant = prev.slice( 0, -1 )
            const last_user = without_last_assistant[ without_last_assistant.length - 1 ]
            if( last_user?.role === `user` ) {
                setTimeout( () => send_message_from_history( without_last_assistant, current_conversation_id ), 0 )
            }
            return without_last_assistant
        } )

    }, [ send_message_from_history, current_conversation_id ] )

    /**
     * Build a /status response with model, prompt, and system metadata.
     * Bypasses the model entirely — the response is injected locally.
     */
    const build_status_response = useCallback( () => {

        const model = get_model_by_id( loaded_model_id )
        const system_prompt = model?.system_prompt || settings.system_prompt || ``
        const opts = get_generate_options()

        const lines = [
            `### Loaded model`,
            model
                ? [
                    `- **Name:** ${ model.name }`,
                    `- **ID:** \`${ model.id }\``,
                    `- **Family:** ${ model.family }`,
                    `- **Parameters:** ${ model.parameters_label }`,
                    `- **Quantization:** ${ model.quantization } (${ model.bpw } bpw)`,
                    `- **Context length:** ${ model.context_length.toLocaleString() } tokens`,
                    `- **File size:** ${ format_file_size( model.file_size_bytes ) }`,
                    model.uncensored ? `- **Uncensored:** yes` : null,
                    model.reasoning ? `- **Reasoning:** yes` : null,
                ].filter( Boolean ).join( `\n` )
                : `- _No model loaded_`,
            ``,
            `### System prompt`,
            system_prompt ? `\`\`\`\n${ system_prompt }\n\`\`\`` : `_No system prompt configured_`,
            ``,
            `### System metadata`,
            `- **App:** ${ DISPLAY_NAME } v${ APP_VERSION }`,
            `- **Platform:** ${ navigator.platform }`,
            `- **User agent:** ${ navigator.userAgent }`,
            `- **Threads:** ${ navigator.hardwareConcurrency || `unknown` }`,
            `- **Device memory:** ${ navigator.deviceMemory ? `${ navigator.deviceMemory } GB` : `unknown` }`,
            `- **Temperature:** ${ opts.temperature }`,
            `- **Max tokens:** ${ opts.max_tokens }`,
            `- **Top-p:** ${ opts.top_p }  |  Top-k: ${ opts.top_k }  |  Min-p: ${ opts.min_p }`,
        ]

        return lines.join( `\n` )

    }, [ loaded_model_id, settings.system_prompt, get_generate_options ] )

    const send_message = useCallback( async ( text ) => {

        // Intercept /status command — respond locally without calling the model
        if( text.trim().toLowerCase() === `/status` ) {

            const user_msg = { id: uuid(), role: `user`, content: text }
            const status_msg = { id: uuid(), role: `assistant`, content: build_status_response() }
            set_messages( prev => [ ...prev, user_msg, status_msg ] )
            return

        }

        const user_msg = { id: uuid(), role: `user`, content: text }
        set_messages( prev => [ ...prev, user_msg ] )

        // Create conversation if this is the first message
        let conv_id = current_conversation_id
        if( !conv_id ) {
            conv_id = await create_conversation( text )
            set_current_conversation_id( conv_id )
            navigate( `/chat/${ conv_id }`, { replace: true } )
        }

        // Save user message to IndexedDB
        await save_message( conv_id, user_msg )

        // Add placeholder assistant message
        const assistant_msg = { id: uuid(), role: `assistant`, content: `` }
        set_messages( prev => [ ...prev, assistant_msg ] )

        // Model-specific system prompt takes priority (e.g. uncensored personas),
        // falling back to user settings → env default
        const active_model = get_model_by_id( loaded_model_id )
        const system_prompt = active_model?.system_prompt || settings.system_prompt || ``
        const history = [ ...messages, user_msg ].map( ( { role, content } ) => ( { role, content } ) )
        if( system_prompt ) history.unshift( { role: `system`, content: system_prompt } )

        // Build generation options from settings hook
        const opts = get_generate_options()

        try {

            const result = await chat_stream( history, opts, ( full_text ) => {
                set_messages( prev => {
                    const updated = [ ...prev ]
                    updated[ updated.length - 1 ] = { ...updated[ updated.length - 1 ], content: full_text }
                    return updated
                } )
            } )

            // Final update with stats and persist
            const final_assistant = {
                ...assistant_msg,
                content: result.text,
                stats: result.stats,
            }

            set_messages( prev => {
                const updated = [ ...prev ]
                updated[ updated.length - 1 ] = final_assistant
                return updated
            } )

            // Save assistant message to IndexedDB
            await save_message( conv_id, final_assistant )
            await refresh()

        } catch ( err ) {
            if( err.name !== `AbortError` ) {

                // Show error inline as an assistant message so the user sees it in context
                const error_content = `**Error:** ${ err.message }`

                set_messages( prev => {
                    const updated = [ ...prev ]
                    updated[ updated.length - 1 ] = {
                        ...updated[ updated.length - 1 ],
                        content: error_content,
                        is_error: true,
                    }
                    return updated
                } )

            }
        }

    }, [ messages, chat_stream, current_conversation_id, create_conversation, save_message, navigate, refresh, get_generate_options, settings.system_prompt, loaded_model_id, build_status_response ] )

    // Process query parameters (?q= and ?model=)
    useEffect( () => {

        if( query_processed_ref.current ) return

        const q_param = search_params.get( `q` )
        const model_param = search_params.get( `model` )

        // No query params to process
        if( !q_param && !model_param ) return

        const process_params = async () => {

            // Handle ?model= parameter — mark processed immediately to prevent
            // StrictMode double-mount from firing the toast multiple times
            if( model_param ) {

                query_processed_ref.current = true
                set_search_params( ( prev ) => {
                    const next = new URLSearchParams( prev )
                    next.delete( `model` )
                    return next
                }, { replace: true } )

                const parsed = parse_model_param( model_param )
                if( parsed ) {
                    const match = resolve_cached_model( parsed, cached_models )
                    if( match ) {
                        try {
                            await load_model( match.id )
                            set_model_loaded( true )
                            localStorage.setItem( storage_key( `active_model_id` ), match.id )
                        } catch {
                            toast.error( t( 'common:failed_to_load_model' ) )
                        }
                    } else if( parsed.type === `local` ) {
                        toast.error( `Model not found: ${ parsed.value }` )
                    }
                }

                // If no ?q= param, we're done
                if( !q_param ) return
            }

            // Handle ?q= parameter — auto-send message once model is ready
            if( q_param && ( model_loaded || loaded_model_id ) ) {
                query_processed_ref.current = true
                set_search_params( {}, { replace: true } )
                setTimeout( () => {
                    send_message( q_param )
                    chat_input_ref.current?.focus()
                }, 100 )
                return
            }

            // Only clean up URL if we're sure model state is resolved (not null = still loading)
            // This prevents wiping ?q= before the model finishes loading
            if( model_loaded !== null ) {
                query_processed_ref.current = true
                set_search_params( {}, { replace: true } )
            }

        }

        process_params()

    }, [ search_params, cached_models, model_loaded, loaded_model_id, load_model, set_search_params, send_message ] )

    /**
     * Edit a message and resend from that point
     */
    const handle_edit = useCallback( ( index, new_text ) => {

        set_messages( prev => {
            // Truncate at the edited message
            const truncated = prev.slice( 0, index )
            // Re-send with edited text
            setTimeout( () => send_message( new_text ), 0 )
            return truncated
        } )

    }, [ send_message ] )

    const handle_stop = useCallback( () => {
        abort()
    }, [ abort ] )

    /**
     * Handle new chat — clear messages and navigate
     */
    const handle_new_chat = useCallback( () => {
        abort()
        set_current_conversation_id( null )
        set_messages( [] )
        navigate( `/chat` )
    }, [ navigate, abort ] )

    // Listen for global new-chat shortcut (Ctrl+N)
    useEffect( () => {

        const on_new_chat = () => handle_new_chat()
        window.addEventListener( EVENTS.new_chat, on_new_chat )
        return () => window.removeEventListener( EVENTS.new_chat, on_new_chat )

    }, [ handle_new_chat ] )

    /**
     * Handle exporting a conversation from sidebar
     */
    const handle_export = useCallback( async ( conversation ) => {
        const msgs = await load_messages( conversation.id )
        export_conversation( conversation, msgs )
    }, [ load_messages ] )

    /**
     * Handle deleting a conversation from sidebar
     */
    const handle_delete = useCallback( async ( id ) => {

        await delete_conversation( id )

        // If we deleted the active conversation, navigate to empty chat
        if( id === current_conversation_id ) {
            set_current_conversation_id( null )
            set_messages( [] )
            navigate( `/chat` )
        }

    }, [ delete_conversation, current_conversation_id, navigate ] )

    /**
     * Handle wiping all conversations from sidebar
     */
    const handle_delete_all = useCallback( async () => {

        await delete_all_conversations()

        // Reset current chat state
        set_current_conversation_id( null )
        set_messages( [] )
        navigate( `/chat` )

    }, [ delete_all_conversations, navigate ] )

    /**
     * Switch to a different cached model
     */
    const handle_model_switch = useCallback( async ( model_id ) => {

        try {
            await load_model( model_id )
            set_model_loaded( true )
            localStorage.setItem( storage_key( `active_model_id` ), model_id )
            await refresh_models()
        } catch ( err ) {
            log.error( `[ChatPage] Failed to switch model:`, err )
            toast.error( err.message || t( 'common:failed_to_load_model' ) )
        }

    }, [ load_model, refresh_models ] )

    // ── Voice input handlers ─────────────────────────────────────────

    const handle_mic_click = useCallback( async () => {

        if( !is_voice_cached ) {
            set_show_voice_dialog( true )
            return
        }

        await start_recording()

    }, [ is_voice_cached, start_recording ] )

    const handle_mic_stop = useCallback( async () => {

        const text = await stop_and_transcribe()
        set_voice_text( null )
        if( text ) set_voice_text( text )

    }, [ stop_and_transcribe ] )

    const handle_voice_confirm = useCallback( async () => {

        set_voice_download_error( false )

        try {

            await download_voice_model()
            set_show_voice_dialog( false )
            await start_recording()

        } catch {
            set_voice_download_error( true )
        }

    }, [ download_voice_model, start_recording ] )

    const handle_voice_dialog_close = useCallback( () => {
        set_show_voice_dialog( false )
        set_voice_download_error( false )
    }, [] )

    const has_messages = messages.length > 0

    // Render the main content area based on state
    const render_content = () => {

        // Model is loading — show a friendly loading state instead of the "no model" CTA
        if( !has_model && is_loading_model ) {
            return <LoadingContainer data-testid="model-loading">
                <SpinnerIcon><LoaderCircle size={ 32 } /></SpinnerIcon>
                <LoadingText>{ t( 'loading_your_model' ) }</LoadingText>
            </LoadingContainer>
        }

        // No model loaded — show a helpful, actionable CTA
        if( !has_model ) {
            return <NoModelContainer>
                <NoModelTitle>{ t( 'lets_get_you_set_up' ) }</NoModelTitle>
                <NoModelText>
                    { t( 'no_model_description' ) }
                </NoModelText>
                <SetupButton
                    data-testid="setup-model-btn"
                    onClick={ () => navigate( `/` ) }
                >
                    { t( 'set_up_a_model' ) } <ArrowRight size={ 16 } />
                </SetupButton>
            </NoModelContainer>
        }

        // Model loaded but no messages — welcome content is rendered
        // inside InputSection (below) so the chat bar can center vertically
        if( !has_messages ) return null

        // Messages exist — show the message list
        return <MessageList
            messages={ messages }
            is_streaming={ is_generating }
            is_endpoint_warming={ is_endpoint_warming }
            on_regenerate={ handle_regenerate }
            on_edit={ handle_edit }
        />
    }

    // Center the input bar when the model is ready but no messages yet
    const should_center = !has_messages && has_model && !is_loading_model

    return <AppLayout
        theme_preference={ theme_preference }
        theme_mode={ theme_mode }
        on_theme_toggle={ on_theme_toggle }
        on_new_chat={ handle_new_chat }
        conversations={ conversations }
        on_export={ handle_export }
        on_delete={ handle_delete }
        on_delete_all={ handle_delete_all }
        cached_models={ cached_models }
        active_model_id={ loaded_model_id }
        is_model_switching={ is_model_switching }
        on_model_switch={ handle_model_switch }
        on_models_purged={ refresh_models }
    >
        <Container>

            { render_content() }

            <InputSection $centered={ should_center }>

                <WelcomeContent $visible={ should_center }>
                    <WelcomeTitle>{ t( 'what_can_i_help_with' ) }</WelcomeTitle>
                    <PrivacyHint>{ t( 'privacy_local' ) }</PrivacyHint>
                    { is_endpoint_warming && <WakingUpIndicator /> }
                </WelcomeContent>

                { /* Warming indicator persists above the input after the welcome area collapses */ }
                { is_endpoint_warming && has_messages && <WakingUpIndicator show_hint /> }

                <ChatInput
                    ref={ chat_input_ref }
                    on_send={ send_message }
                    on_stop={ handle_stop }
                    is_generating={ is_generating }
                    disabled={ !has_model }
                    auto_focus
                    on_mic_click={ handle_mic_click }
                    on_mic_stop={ handle_mic_stop }
                    is_recording={ is_recording }
                    is_transcribing={ is_transcribing }
                    is_loading_model={ is_voice_loading_model }
                    audio_level={ voice_audio_level }
                    recording_start_time={ voice_recording_start_time }
                    append_text={ voice_text }
                />

            </InputSection>

        </Container>

        { /* Voice model download dialog */ }
        <VoiceModelDialog
            is_open={ show_voice_dialog }
            on_close={ handle_voice_dialog_close }
            on_confirm={ handle_voice_confirm }
            is_downloading={ is_voice_downloading }
            download_progress={ voice_download_progress }
            has_error={ voice_download_error }
            on_retry={ handle_voice_confirm }
        />

    </AppLayout>

}
