import { useState, useEffect, useCallback } from 'react'
import styled, { keyframes } from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { log } from 'mentie'
import { ArrowLeftRight, AlertCircle, RotateCcw, PanelLeft, Cloud, HardDrive } from 'lucide-react'
import ChatInput from '../molecules/ChatInput'
import VoiceModelDialog from '../molecules/VoiceModelDialog'
import LanguageSelector from '../molecules/LanguageSelector'
import Sidebar from '../molecules/Sidebar'
import use_llm from '../../hooks/use_llm'
import use_model_manager from '../../hooks/use_model_manager'
import use_voice_input from '../../hooks/use_voice_input'
import use_chat_history from '../../hooks/use_chat_history'
import { useTranslation } from 'react-i18next'
import { export_conversation } from '../../utils/export'
import { DISPLAY_NAME, storage_key } from '../../utils/branding'
import { is_model_fit_error } from '../../utils/model_fit_error'

// ── Layout ──────────────────────────────────────────────────────────

const PageWrapper = styled.div`
    display: flex;
    flex: 1;
    position: relative;
    overflow: hidden;
`

const Container = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: ${ ( { theme } ) => theme.spacing.xl };
`

// Matches the TopBar IconButton style
const SidebarToggle = styled.button`
    position: absolute;
    top: ${ ( { theme } ) => theme.spacing.md };
    left: ${ ( { theme } ) => theme.spacing.md };
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 2.75rem;
    min-height: 2.75rem;
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    color: ${ ( { theme } ) => theme.colors.text_muted };
    transition: color 0.15s;

    &:hover {
        color: ${ ( { theme } ) => theme.colors.text };
    }
`

const TopRight = styled.div`
    position: absolute;
    top: ${ ( { theme } ) => theme.spacing.md };
    right: ${ ( { theme } ) => theme.spacing.md };
    z-index: 10;
`

const Title = styled.h1`
    font-size: clamp( 2.5rem, 2rem + 3vw, 4rem );
    color: ${ ( { theme } ) => theme.colors.text };
    border-bottom: 3px solid ${ ( { theme } ) => theme.colors.accent };
    margin-bottom: 2rem;
    letter-spacing: -0.02em;
`

const Tagline = styled.p`
    font-size: clamp( 1rem, 0.9rem + 0.3vw, 1.2rem );
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    margin-bottom: ${ ( { theme } ) => theme.spacing.xl };
    text-align: center;
`

// ── Model status ────────────────────────────────────────────────────

const ModelRow = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    margin-top: ${ ( { theme } ) => theme.spacing.lg };
    font-size: 0.85rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    min-height: 1.5rem;
`

const ModelTag = styled.span`
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 0.65rem;
    font-weight: 600;
    color: ${ ( { $cloud, theme } ) => $cloud ? theme.colors.info : theme.colors.text_muted };
    text-transform: uppercase;
    letter-spacing: 0.03em;
`

const SwitchIcon = styled.button`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    padding: 2px;
    border-radius: ${ ( { theme } ) => theme.border_radius.sm };
    transition: color 0.15s, background 0.15s;

    &:hover {
        color: ${ ( { theme } ) => theme.colors.text };
        background: ${ ( { theme } ) => theme.colors.surface_hover };
    }
`

// ── Pulsing loading dot ─────────────────────────────────────────────

const pulse = keyframes`
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
`

const LoadingDot = styled.span`
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    background: ${ ( { theme } ) => theme.colors.accent };
    animation: ${ pulse } 1.5s ease-in-out infinite;

    @media ( prefers-reduced-motion: reduce ) {
        animation: none;
    }
`

// ── Error banner ────────────────────────────────────────────────────

const ErrorBanner = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    margin-top: ${ ( { theme } ) => theme.spacing.lg };
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.md }` };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    background: ${ ( { theme } ) => theme.colors.error_background || `rgba( 200, 60, 60, 0.08 )` };
    color: ${ ( { theme } ) => theme.colors.error || `#b85c5c` };
    font-size: 0.85rem;
    max-width: 540px;
    width: 100%;
`

const ErrorAction = styled.button`
    font-size: 0.85rem;
    font-weight: 600;
    color: ${ ( { theme } ) => theme.colors.accent };
    white-space: nowrap;
    transition: opacity 0.15s;

    &:hover { opacity: 0.7; }
`

// ── Component ───────────────────────────────────────────────────────

/**
 * Google-style search home for returning users.
 * Preloads the active model on mount so chat is instant.
 */
export default function HomePage() {

    const { t } = useTranslation( 'pages' )
    const navigate = useNavigate()

    const { load_model, unload_model, is_loading, loaded_model_id } = use_llm()
    const { cached_models } = use_model_manager()
    const { conversations, load_messages, delete_conversation, delete_all_conversations } = use_chat_history()

    const [ load_error, set_load_error ] = useState( null )
    const [ sidebar_collapsed, set_sidebar_collapsed ] = useState( true )

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

    // Resolve active model name for display
    const active_id = localStorage.getItem( storage_key( `active_model_id` ) )
    const active_model = cached_models.find( ( m ) => m.id === active_id )
    const model_name = active_model?.name || active_id || `Unknown`
    const is_cloud = active_model?.source === 'openrouter'

    // ── Preload model on mount ──────────────────────────────────────

    useEffect( () => {

        if( !active_id ) return

        // Cleanup flag prevents the superseded first call (StrictMode double-mount)
        // from flashing the error banner before the real call completes
        let cancelled = false

        load_model( active_id ).catch( ( err ) => {
            if( cancelled ) return
            log.error( `[HomePage] Preload failed:`, err.message )
            set_load_error( { message: err.message, code: err.code } )
        } )

        return () => {
            cancelled = true
        }

    }, [] )

    // Clear stale error if the model loaded via a concurrent path
    // (e.g. StrictMode double-mount or navigation race)
    useEffect( () => {
        if( loaded_model_id && load_error ) set_load_error( null )
    }, [ loaded_model_id ] )

    // ── Handlers ────────────────────────────────────────────────────

    const handle_send = useCallback( ( text ) => {
        navigate( `/chat?q=${ encodeURIComponent( text ) }` )
    }, [ navigate ] )

    // Retry loading after a transient failure
    const handle_retry = useCallback( () => {

        if( !active_id ) return

        set_load_error( null )
        load_model( active_id ).catch( ( err ) => {
            log.error( `[HomePage] Retry failed:`, err.message )
            set_load_error( { message: err.message, code: err.code } )
        } )

    }, [ active_id, load_model ] )

    // Cancel any in-progress load and jump to model picker
    const handle_switch_model = useCallback( () => {
        unload_model()
        navigate( '/select-model' )
    }, [ unload_model, navigate ] )

    // ── Voice input handlers ────────────────────────────────────────

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

    // ── Sidebar handlers ───────────────────────────────────────────

    const handle_sidebar_toggle = useCallback( () => {
        set_sidebar_collapsed( ( prev ) => !prev )
    }, [] )

    const handle_new_chat = useCallback( () => {
        navigate( `/chat` )
    }, [ navigate ] )

    const handle_export = useCallback( async ( conversation ) => {
        const msgs = await load_messages( conversation.id )
        export_conversation( conversation, msgs )
    }, [ load_messages ] )

    const handle_delete = useCallback( async ( id ) => {
        await delete_conversation( id )
    }, [ delete_conversation ] )

    const handle_delete_all = useCallback( async () => {
        await delete_all_conversations()
    }, [ delete_all_conversations ] )

    // ── Render ──────────────────────────────────────────────────────

    return <PageWrapper>

        <Sidebar
            collapsed={ sidebar_collapsed }
            on_toggle={ handle_sidebar_toggle }
            on_new_chat={ handle_new_chat }
            conversations={ conversations }
            on_export={ handle_export }
            on_delete={ handle_delete }
            on_delete_all={ handle_delete_all }
        />

        { /* Language selector — top right corner */ }
        <TopRight>
            <LanguageSelector />
        </TopRight>

        { /* Toggle button — only visible when sidebar is closed */ }
        { sidebar_collapsed && <SidebarToggle
            onClick={ handle_sidebar_toggle }
            aria-label={ t( 'common:aria_open_sidebar' ) }
            data-testid="home-sidebar-toggle"
        >
            <PanelLeft size={ 18 } />
        </SidebarToggle> }

        <Container>

            <Title>{ DISPLAY_NAME }</Title>
            <Tagline>
                { t( 'tagline' ) }
            </Tagline>

            <ChatInput
                on_send={ handle_send }
                as_form
                max_width="540px"
                placeholder={ t( 'chat:placeholder_ask' ) }
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

            { /* Model status row — name, ready state, switch icon */ }
            <ModelRow>

                { is_loading && <>
                    <LoadingDot />
                    <span>{ t( 'loading_model', { name: model_name } ) }</span>
                    <ModelTag $cloud={ is_cloud }>
                        { is_cloud ? <><Cloud size={ 10 } /> { t( 'cloud' ) }</> : <><HardDrive size={ 10 } /> { t( 'local' ) }</> }
                    </ModelTag>
                    <SwitchIcon
                        onClick={ handle_switch_model }
                        title={ t( 'switch_model' ) }
                        data-testid="home-switch-model"
                    >
                        <ArrowLeftRight size={ 14 } />
                    </SwitchIcon>
                </> }

                { !is_loading && loaded_model_id && <>
                    <span>{ t( 'model_ready', { name: model_name } ) }</span>
                    <ModelTag $cloud={ is_cloud }>
                        { is_cloud ? <><Cloud size={ 10 } /> { t( 'cloud' ) }</> : <><HardDrive size={ 10 } /> { t( 'local' ) }</> }
                    </ModelTag>
                    <SwitchIcon
                        onClick={ handle_switch_model }
                        title={ t( 'switch_model' ) }
                        data-testid="home-switch-model"
                    >
                        <ArrowLeftRight size={ 14 } />
                    </SwitchIcon>
                </> }

            </ModelRow>

            { /* Error banner — only after loading settles, never mid-load */ }
            { !is_loading && load_error && <ErrorBanner data-testid="home-load-error">
                <AlertCircle size={ 14 } />
                <span>{ is_model_fit_error( load_error )
                    ? t( `models:model_does_not_fit` )
                    : load_error.message || t( 'failed_to_load' ) }</span>
                { !is_model_fit_error( load_error ) && <ErrorAction onClick={ handle_retry } data-testid="home-retry-btn">
                    <RotateCcw size={ 12 } /> { t( 'common:retry' ) }
                </ErrorAction> }
                <ErrorAction onClick={ () => navigate( `/select-model` ) } data-testid="home-choose-another-btn">
                    { t( 'choose_another' ) }
                </ErrorAction>
            </ErrorBanner> }

        </Container>

    </PageWrapper>

}
