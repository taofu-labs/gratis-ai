import { useState, useEffect, useCallback, useRef } from 'react'
import styled, { keyframes } from 'styled-components'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
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
import { MODEL_CATALOG, get_model_by_id, format_file_size, has_image_input, model_download_bytes, select_for_preferences } from '../../utils/model_catalog'
import { estimate_history_tokens, split_documents } from '../../utils/attachments'
import { projector_source } from '../../utils/model_download'
import { build_device_profile, detect_capabilities, estimate_max_model_bytes } from '../../utils/device_detection'
import { useTranslation } from 'react-i18next'
import Button from '../atoms/Button'
import ModelLoadStage from '../atoms/ModelLoadStage'
import { storage_key, EVENTS, DISPLAY_NAME, APP_VERSION } from '../../utils/branding'

// How often a streaming reply is written to IndexedDB, so a closed tab keeps it
const PARTIAL_SAVE_INTERVAL_MS = 2_000

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
 * @returns {JSX.Element}
 */
export default function ChatPage() {

    const { id: conversation_id } = useParams()
    const navigate = useNavigate()
    const location = useLocation()
    const [ search_params, set_search_params ] = useSearchParams()
    const { t } = useTranslation( 'chat' )

    const [ messages, set_messages ] = useState( [] )
    // A ?q= message that arrived while the model was still loading
    const [ pending_query, set_pending_query ] = useState( null )
    // Initialize as null = "haven't tried loading yet" to distinguish from "tried and failed"
    const [ model_loaded, set_model_loaded ] = useState( null )
    // Start as null even with a URL param — we validate it exists before accepting it
    const [ current_conversation_id, set_current_conversation_id ] = useState( null )
    const chat_input_ref = useRef( null )
    const is_generating_ref = useRef( false )
    const query_processed_ref = useRef( false )
    const pending_conversation_id_ref = useRef( null )
    const partial_reply_ref = useRef( null )

    // Settles once every started reply has finished streaming *and* saving.
    // The store drops is_generating before the final save lands, so history
    // rewrites (edit, regenerate, delete) wait on this instead.
    const replies_settled_ref = useRef( Promise.resolve() )
    // An edit or regenerate is waiting on storage; blocks a second one
    const rewriting_ref = useRef( false )
    const rewrite_owner_ref = useRef( 0 )
    const [ is_rewriting, set_is_rewriting ] = useState( false )

    // Bumped whenever the visible chat is swapped out (New Chat, navigation,
    // delete). Async flows capture it up front and drop their work once stale.
    const epoch_ref = useRef( 0 )
    const capture_epoch = () => {
        const epoch = epoch_ref.current
        return () => epoch_ref.current === epoch
    }

    // Latest messages for async flows (edit, regenerate) that outlive a render
    const messages_ref = useRef( messages )
    messages_ref.current = messages

    const { load_model, chat_stream, abort, is_generating, is_endpoint_warming, is_loading: is_model_loading, loaded_model_id, capabilities } = use_llm()
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
    // If a different model is pending, the stale loaded model
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
                    // Fixed id: a remount or retry replaces the toast instead of stacking another
                    toast.error( err.message || t( 'common:failed_to_load_model' ), { id: `model-load-error` } )
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
    const route_conversation_ref = useRef( conversation_id )
    route_conversation_ref.current = conversation_id

    // Navigating to another chat invalidates pending work of the previous one,
    // except our own first-message hop from /chat to /chat/:new_id
    const last_route_ref = useRef( conversation_id )
    useEffect( () => {

        if( conversation_id === last_route_ref.current ) return
        last_route_ref.current = conversation_id
        if( conversation_id && conversation_id === pending_conversation_id_ref.current ) return
        epoch_ref.current++

    }, [ conversation_id ] )

    useEffect( () => {

        if( conversation_id === pending_conversation_id_ref.current ) {
            pending_conversation_id_ref.current = null
        }

        if( conversation_id && conversation_id !== current_conversation_id ) {

            // Validate that the conversation exists before loading messages
            load_messages( conversation_id ).then( ( msgs ) => {

                // New Chat clears state one render before the URL drops the
                // old id; a load resolving after that must not resurrect it
                if( route_conversation_ref.current !== conversation_id ) return

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
                    attachments: m.attachments,
                    stats: m.stats,
                    error: m.error,
                    // Keep the original order when edits and regenerates rewrite history
                    created_at: m.created_at,
                } ) ) )

            } )

        }

        // Reset state when navigating to /chat (no id)
        if( !conversation_id
            && current_conversation_id
            && pending_conversation_id_ref.current !== current_conversation_id ) {
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
     * Save the streaming reply marked as interrupted, so a closed tab keeps
     * what already arrived. Writes are chained: a slow one can never land
     * after the final save and overwrite the finished reply.
     * @param {Object} partial - The live reply tracked in partial_reply_ref
     * @returns {Promise<void>}
     */
    const save_partial_reply = useCallback( ( partial ) => {

        if( partial.done || !partial.text || !partial.conv_id ) return partial.saving

        partial.saved_at = Date.now()
        const snapshot = { ...partial.message, content: partial.text, stats: { interrupted: true } }
        partial.saving = partial.saving
            .then( () => save_message( partial.conv_id, snapshot ) )
            .catch( err => log.warn( `[ChatPage] Could not save partial reply:`, err ) )

        return partial.saving

    }, [ save_message ] )

    // Last chance to keep a streaming reply when the tab closes or navigates away
    useEffect( () => {

        const on_pagehide = () => {
            if( partial_reply_ref.current ) save_partial_reply( partial_reply_ref.current )
        }
        window.addEventListener( `pagehide`, on_pagehide )
        return () => window.removeEventListener( `pagehide`, on_pagehide )

    }, [ save_partial_reply ] )

    /**
     * Stream an assistant reply to the given history, persisting it while it
     * streams and once it completes or is stopped.
     * @param {string|null} conv_id - Conversation to save into; null skips saving
     * @param {Array} history_msgs - Messages the reply answers
     * @returns {Promise<void>}
     */
    const stream_reply = useCallback( ( conv_id, history_msgs ) => {

        const assistant_msg = { id: uuid(), role: `assistant`, content: ``, created_at: Date.now() }
        set_messages( prev => [ ...prev, assistant_msg ] )

        // Updates by id, so a reply whose chat was swapped out touches nothing
        const update_reply = changes => set_messages( prev => prev.map( m =>
            m.id === assistant_msg.id ? { ...m, ...changes } : m
        ) )

        // Model-specific system prompt takes priority (e.g. uncensored personas),
        // falling back to user settings → env default. Empty replies (a stop
        // before the first token) carry nothing for the model.
        const active_model = get_model_by_id( loaded_model_id )
        const system_prompt = active_model?.system_prompt || settings.system_prompt || ``
        // Strict templates (Gemma, Mistral) demand alternating roles, so turns
        // left adjacent by a dropped empty reply are merged
        const history = history_msgs
            .filter( ( { content, attachments } ) => content || attachments?.length )
            .reduce( ( turns, { role, content, attachments } ) => {
                const images = attachments?.filter( ( { kind } ) => kind === `image` ) || []
                const previous = turns.at( -1 )
                if( previous?.role === role ) {
                    previous.content = [ previous.content, content ].filter( Boolean ).join( `\n\n` )
                    previous.attachments = [ ...previous.attachments || [], ...images ]
                } else turns.push( { role, content, ... images.length ? { attachments: images } : {} } )
                return turns
            }, [] )
        if( system_prompt ) history.unshift( { role: `system`, content: system_prompt } )

        const partial = {
            conv_id,
            message: assistant_msg,
            text: ``,
            saved_at: Date.now(),
            saving: Promise.resolve(),
            done: false,
        }
        partial_reply_ref.current = partial

        const reply = ( async () => {

            try {

                const result = await chat_stream( history, get_generate_options(), ( full_text ) => {
                    update_reply( { content: full_text } )
                    partial.text = full_text
                    if( Date.now() - partial.saved_at >= PARTIAL_SAVE_INTERVAL_MS ) save_partial_reply( partial )
                } )

                partial.done = true
                const final_assistant = { ...assistant_msg, content: result.text, stats: result.stats }
                update_reply( final_assistant )

                // Saved into its own conversation even if the user moved on
                if( conv_id ) {
                    await partial.saving
                    await save_message( conv_id, final_assistant )
                    await refresh()
                }

            } catch ( err ) {

                // Keep what already arrived and record the error beside it, never
                // inside content: the model's history must hold only its own words
                partial.done = true
                const failed_reply = { ...assistant_msg, content: partial.text, stats: { interrupted: true }, error: err.message }
                update_reply( failed_reply )
                if( conv_id ) {
                    await partial.saving
                    await save_message( conv_id, failed_reply ).catch( save_error => log.warn( `[ChatPage] Could not save failed reply:`, save_error ) )
                }

            } finally {
                if( partial_reply_ref.current === partial ) partial_reply_ref.current = null
            }

        } )()

        replies_settled_ref.current = Promise.allSettled( [ replies_settled_ref.current, reply ] )
        return reply

    }, [ chat_stream, save_message, save_partial_reply, refresh, get_generate_options, settings.system_prompt, loaded_model_id ] )

    /**
     * Rewrite stored history once earlier replies have finished saving, so a
     * stopped reply's late final save cannot re-insert what was just removed.
     * @param {Function} is_current - Epoch check; a swapped-out chat skips the write
     * @param {Array} msgs - The history to keep
     * @param {Function} next - Starts the replacement reply once storage is rewritten
     * @returns {Promise<void>}
     */
    const rewrite_history = useCallback( async ( is_current, msgs, next ) => {

        // Held through the replacement reply, so a user send can never land in
        // history being rewritten. Only the newest rewrite may release it.
        const owner = ++rewrite_owner_ref.current
        rewriting_ref.current = true
        set_is_rewriting( true )

        try {
            await replies_settled_ref.current
            if( !is_current() ) return
            if( current_conversation_id ) await replace_messages( current_conversation_id, msgs )
            if( !is_current() ) return
            await next()
        } finally {
            if( rewrite_owner_ref.current === owner ) {
                rewriting_ref.current = false
                set_is_rewriting( false )
            }
        }

    }, [ replace_messages, current_conversation_id ] )

    /**
     * Regenerate the last assistant message
     */
    const handle_regenerate = useCallback( async () => {

        // History stays readable while the model loads; rewriting it must wait
        const history_msgs = messages_ref.current.slice( 0, -1 )
        if( !has_model || is_generating_ref.current || rewriting_ref.current ) return
        if( history_msgs.at( -1 )?.role !== `user` ) return

        const is_current = capture_epoch()
        set_messages( history_msgs )

        // Drop the old reply from storage first, so a reload mid-stream never shows both
        await rewrite_history( is_current, history_msgs, () => stream_reply( current_conversation_id, history_msgs ) )

    }, [ stream_reply, rewrite_history, current_conversation_id, has_model ] )

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

    /**
     * Send a user message and stream the reply.
     * @param {string} text - Content, documents already inlined
     * @param {Object} [options]
     * @param {Array} [options.attachments] - Images plus document chip metadata
     * @param {Array} [options.base_messages] - History it follows; defaults to the current chat
     */
    const send_message = useCallback( async ( text, { attachments, base_messages = messages_ref.current } = {} ) => {

        // Intercept /status command — respond locally without calling the model
        if( text.trim().toLowerCase() === `/status` ) {

            const user_msg = { id: uuid(), role: `user`, content: text, created_at: Date.now() }
            const status_msg = { id: uuid(), role: `assistant`, content: build_status_response(), created_at: Date.now() }
            set_messages( prev => [ ...prev, user_msg, status_msg ] )
            return

        }

        const is_current = capture_epoch()
        const user_msg = { id: uuid(), role: `user`, content: text, ... attachments ? { attachments } : {}, created_at: Date.now() }
        set_messages( prev => [ ...prev, user_msg ] )

        // Create conversation if this is the first message. If the user left
        // meanwhile, it is still saved, but must not pull them back into it.
        let conv_id = current_conversation_id
        if( !conv_id ) {
            const { text: typed, names } = split_documents( text )
            conv_id = await create_conversation( typed || names[ 0 ] || attachments?.[ 0 ]?.name || t( `image_conversation_title` ) )
            if( is_current() ) {
                pending_conversation_id_ref.current = conv_id
                set_current_conversation_id( conv_id )
                navigate( `/chat/${ conv_id }`, { replace: true } )
            }
        }

        // Save user message to IndexedDB
        await save_message( conv_id, user_msg )

        // A chat swapped out while storage was busy gets no reply streamed into it
        if( !is_current() ) return
        await stream_reply( conv_id, [ ...base_messages, user_msg ] )

    }, [ stream_reply, current_conversation_id, create_conversation, save_message, navigate, build_status_response, t ] )

    // User sends wait out a pending history rewrite; internal resends bypass this
    const handle_send = useCallback( ( text, attachments ) => {
        if( rewriting_ref.current ) return
        return send_message( text, { attachments } )
    }, [ send_message ] )

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
                set_search_params( ( prev ) => {
                    const next = new URLSearchParams( prev )
                    next.delete( `q` )
                    return next
                }, { replace: true } )
                await send_message( q_param )
                chat_input_ref.current?.focus()
                return
            }

            // Model still loading: show the message right away, send it once ready
            if( q_param && has_pending_model && model_loaded !== false ) {
                query_processed_ref.current = true
                set_search_params( ( prev ) => {
                    const next = new URLSearchParams( prev )
                    next.delete( `q` )
                    return next
                }, { replace: true } )
                set_pending_query( { id: uuid(), text: q_param, epoch: epoch_ref.current } )
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

    }, [ search_params, cached_models, model_loaded, loaded_model_id, load_model, set_search_params, send_message, has_pending_model ] )

    // Send the queued ?q= message once the model is ready. If loading fails,
    // hand the text to the input instead of dropping it.
    useEffect( () => {

        if( !pending_query ) return

        // Bound to the chat it arrived in; New Chat or navigation drops it
        if( pending_query.epoch !== epoch_ref.current ) {
            set_pending_query( null )
            return
        }

        if( has_model ) {
            set_pending_query( null )
            send_message( pending_query.text )
            return
        }

        if( model_loaded === false && !is_model_loading ) {
            set_pending_query( null )
            set_voice_text( pending_query.text )
        }

    }, [ pending_query, has_model, model_loaded, is_model_loading, send_message ] )

    /**
     * Edit a message and resend from that point
     */
    const handle_edit = useCallback( async ( index, new_text ) => {

        // One reply at a time: a second run would steal the stop control and
        // the first would later re-save into the truncated history
        if( !has_model || is_generating_ref.current || rewriting_ref.current ) return

        // Truncate at the edited message, in storage too, then re-send with
        // its documents and images: the edit only changes the typed text
        const is_current = capture_epoch()
        const { attachments, content } = messages_ref.current[ index ]
        const { blocks } = split_documents( content )
        const truncated = messages_ref.current.slice( 0, index )
        set_messages( truncated )
        await rewrite_history( is_current, truncated, () => send_message( `${ blocks }${ new_text }`.trim(), { attachments, base_messages: truncated } ) )

    }, [ send_message, rewrite_history, has_model ] )

    const handle_stop = useCallback( () => {
        abort()
    }, [ abort ] )

    /**
     * Handle new chat — clear messages and navigate
     */
    const handle_new_chat = useCallback( () => {
        abort()
        epoch_ref.current++
        set_pending_query( null )
        pending_conversation_id_ref.current = null
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

        // Stop a reply still streaming or saving into this chat and let its
        // writes land first, or they would leave orphaned messages behind
        const is_active = id === current_conversation_id
        const is_replying = partial_reply_ref.current?.conv_id === id
        if( is_active ) epoch_ref.current++
        if( is_active || is_replying ) {
            abort()
            await replies_settled_ref.current
        }
        await delete_conversation( id )

        // If we deleted the active conversation, navigate to empty chat
        if( is_active ) {
            set_current_conversation_id( null )
            set_messages( [] )
            navigate( `/chat` )
        }

    }, [ delete_conversation, current_conversation_id, navigate, abort ] )

    /**
     * Handle wiping all conversations from sidebar
     */
    const handle_delete_all = useCallback( async () => {

        abort()
        epoch_ref.current++
        await replies_settled_ref.current
        await delete_all_conversations()

        // Reset current chat state
        set_current_conversation_id( null )
        set_messages( [] )
        navigate( `/chat` )

    }, [ delete_all_conversations, navigate, abort ] )

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

    // ── Image input: what to offer when the model cannot read images ──

    // The best vision model this device fits, for the inline offer
    const [ vision_candidate, set_vision_candidate ] = useState( null )
    useEffect( () => {

        if( capabilities.image_input ) return
        let cancelled = false
        detect_capabilities()
            .then( device_capabilities => build_device_profile( device_capabilities, estimate_max_model_bytes( device_capabilities ) ) )
            .then( device => select_for_preferences( MODEL_CATALOG, device, { vision: true } ).pick )
            .then( pick => !cancelled && set_vision_candidate( has_image_input( pick ) ? pick : null ) )
            .catch( error => log.debug( `[ChatPage] No vision suggestion:`, error?.message ) )
        return () => {
            cancelled = true
        }

    }, [ capabilities.image_input ] )

    const vision_offer = ( () => {

        if( capabilities.image_input ) return null
        const loaded_model = get_model_by_id( loaded_model_id ) || cached_models.find( ( { id } ) => id === loaded_model_id )
        const choose_model = { testid: `choose-vision-model`, label: t( `choose_vision_model` ), on_click: () => navigate( `/select-model?need=vision` ) }

        // The model reads images once its projector is downloaded
        if( capabilities.image_blocked === `projector_missing` && loaded_model ) {
            const projector = projector_source( loaded_model )
            return {
                message: t( `image_needs_projector`, { name: loaded_model.name } ),
                actions: [ {
                    testid: `add-image-support`,
                    label: t( `add_image_support`, { size: format_file_size( projector.file_size_bytes ) } ),
                    on_click: () => navigate( `/download`, { state: { model: loaded_model, return_to: location.pathname } } ),
                } ],
            }
        }

        // An installed vision model is a switch, not a download
        const installed = cached_models.find( model => model.id !== loaded_model_id && has_image_input( get_model_by_id( model.id ) || model ) )
        const offer = installed
            ? { testid: `switch-vision-model`, label: t( `switch_to_model`, { name: installed.name } ), on_click: () => handle_model_switch( installed.id ) }
            : vision_candidate && {
                testid: `get-vision-model`,
                label: t( `get_vision_model`, { name: vision_candidate.name, size: format_file_size( model_download_bytes( vision_candidate ) ) } ),
                on_click: () => navigate( `/download`, { state: { model: vision_candidate, return_to: location.pathname } } ),
            }

        return {
            message: t( capabilities.image_blocked === `memory` ? `image_blocked_memory` : `image_needs_vision` ),
            actions: [ offer, choose_model ].filter( Boolean ),
        }

    } )()

    const history_tokens = estimate_history_tokens( messages )

    const has_messages = messages.length > 0 || !!pending_query

    // Render the main content area based on state
    const render_content = () => {

        // A ?q= message waits for the model: show it with a waiting reply below
        if( pending_query ) {
            return <MessageList
                messages={ [
                    ...messages,
                    { id: pending_query.id, role: `user`, content: pending_query.text },
                    { id: `${ pending_query.id }-reply`, role: `assistant`, content: `` },
                ] }
                is_streaming
                is_cloud_model={ false }
            />
        }

        // Model is loading — show a friendly loading state instead of the "no model" CTA.
        // An existing conversation stays readable meanwhile; only the input waits.
        if( !has_model && is_loading_model && !has_messages ) {
            return <LoadingContainer data-testid="model-loading">
                <SpinnerIcon><LoaderCircle size={ 32 } /></SpinnerIcon>
                <LoadingText>{ t( 'loading_your_model' ) }</LoadingText>
                <ModelLoadStage />
            </LoadingContainer>
        }

        // No model loaded — show a helpful, actionable CTA
        if( !has_model && !is_loading_model ) {
            return <NoModelContainer>
                <NoModelTitle>{ t( 'lets_get_you_set_up' ) }</NoModelTitle>
                <NoModelText>
                    { t( 'no_model_description' ) }
                </NoModelText>
                <Button
                    data-testid="setup-model-btn"
                    onClick={ () => navigate( `/` ) }
                >
                    { t( 'set_up_a_model' ) } <ArrowRight size={ 16 } />
                </Button>
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
            is_cloud_model={ false }
            on_regenerate={ handle_regenerate }
            on_edit={ handle_edit }
        />
    }

    // Center the input bar when the model is ready but no messages yet
    const should_center = !has_messages && has_model && !is_loading_model

    return <AppLayout
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

                { /* Unmounted once a chat exists, so it never lingers invisibly */ }
                { !has_messages && <WelcomeContent $visible={ should_center } aria-hidden={ !should_center }>
                    <WelcomeTitle>{ t( 'what_can_i_help_with' ) }</WelcomeTitle>
                    <PrivacyHint>{ t( `privacy_local` ) }</PrivacyHint>
                    { is_endpoint_warming && <WakingUpIndicator /> }
                </WelcomeContent> }

                { /* Warming indicator persists above the input after the welcome area collapses */ }
                { is_endpoint_warming && has_messages && <WakingUpIndicator show_hint /> }

                <ChatInput
                    ref={ chat_input_ref }
                    on_send={ handle_send }
                    on_stop={ handle_stop }
                    is_generating={ is_generating }
                    disabled={ !has_model || is_rewriting }
                    auto_focus
                    allow_images
                    vision_offer={ vision_offer }
                    history_tokens={ history_tokens }
                    max_tokens={ settings.max_tokens }
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
