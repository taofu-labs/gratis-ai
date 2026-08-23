import { useState, useEffect, useRef } from 'react'
import styled, { keyframes } from 'styled-components'
import { Plus, PanelLeftClose, PanelLeft, Download, Trash2, Trash, Monitor, RefreshCw, LoaderCircle, CheckCircle } from 'lucide-react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { truncate } from '../../utils/format'
import ModelSelector from './ModelSelector'

const SidebarContainer = styled.aside`
    display: flex;
    flex-direction: column;
    width: ${ ( { $collapsed } ) => $collapsed ? `0px` : `260px` };
    min-width: ${ ( { $collapsed } ) => $collapsed ? `0px` : `260px` };
    background: ${ ( { theme } ) => theme.colors.sidebar };
    border-right: 1px solid ${ ( { theme } ) => theme.colors.border_subtle };
    transition: all 0.2s ease;
    overflow: hidden;

    @media ( prefers-reduced-motion: reduce ) {
        transition: none;
    }

    @media ( max-width: ${ ( { theme } ) => theme.breakpoints.mobile } ) {
        position: absolute;
        z-index: 100;
        top: 0;
        bottom: 0;
        width: ${ ( { $collapsed } ) => $collapsed ? `0px` : `260px` };
    }
`

// Mobile backdrop — closes sidebar on tap outside
const Backdrop = styled.div`
    display: none;

    @media ( max-width: ${ ( { theme } ) => theme.breakpoints.mobile } ) {
        display: ${ ( { $visible } ) => $visible ? `block` : `none` };
        position: fixed;
        inset: 0;
        background: rgba( 0, 0, 0, 0.3 );
        z-index: 99;
    }
`

const SidebarHeader = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: ${ ( { theme } ) => theme.spacing.sm };
    min-height: 56px;
`

const NewChatButton = styled.button`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } ${ theme.spacing.sm }` };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    color: ${ ( { theme } ) => theme.colors.text };
    font-size: 0.85rem;
    transition: opacity 0.15s;
    min-height: 2.75rem;

    &:hover { opacity: 0.7; }
`

const CollapseButton = styled.button`
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 2.75rem;
    min-height: 2.75rem;
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    color: ${ ( { theme } ) => theme.colors.text_muted };
    transition: color 0.15s;

    &:hover { color: ${ ( { theme } ) => theme.colors.text }; }
`

// Model selector section — visible on mobile only
const MobileModelSection = styled.div`
    display: none;
    padding: ${ ( { theme } ) => `0 ${ theme.spacing.sm } ${ theme.spacing.xs }` };

    @media ( max-width: ${ ( { theme } ) => theme.breakpoints.mobile } ) {
        display: block;
    }
`

const ConversationListContainer = styled.div`
    flex: 1;
    overflow-y: auto;
    padding: ${ ( { theme } ) => theme.spacing.xs };
`

const EmptyState = styled.div`
    padding: ${ ( { theme } ) => theme.spacing.xl };
    text-align: center;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    font-size: 0.85rem;
    line-height: 1.5;
`

const ConversationItem = styled.div`
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.sm }` };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    text-align: left;
    font-size: 0.85rem;
    color: ${ ( { theme } ) => theme.colors.text };
    font-weight: ${ ( { $active } ) => $active ? `600` : `400` };
    background: transparent;
    transition: background 0.15s;
    min-height: 2.75rem;

    &:hover {
        background: ${ ( { theme } ) => theme.colors.surface_hover };
    }

    &:hover .conv-actions {
        opacity: 1;
    }
`

const ConversationTitle = styled.span`
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

const ConversationActions = styled.div`
    display: flex;
    align-items: center;
    gap: 4px;
    opacity: ${ ( { $visible } ) => $visible ? 1 : 0 };
    transition: opacity 0.15s;
`

const ActionIcon = styled.button`
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 2rem;
    min-height: 2rem;
    border-radius: ${ ( { theme } ) => theme.border_radius.sm };
    color: ${ ( { theme, $confirming } ) => $confirming ? theme.colors.error : theme.colors.text_muted };
    font-size: 0.7rem;
    white-space: nowrap;
    transition: color 0.15s, background 0.15s;

    &:hover {
        color: ${ ( { theme, $confirming } ) => $confirming ? theme.colors.error : theme.colors.text };
        background: ${ ( { theme } ) => theme.colors.code_background };
    }
`

const SidebarFooter = styled.div`
    padding: ${ ( { theme } ) => theme.spacing.sm };
    border-top: 1px solid ${ ( { theme } ) => theme.colors.border_subtle };
`

const WipeButton = styled.button`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    width: 100%;
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } ${ theme.spacing.sm }` };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    color: ${ ( { theme, $confirming } ) => $confirming ? theme.colors.error : theme.colors.text_muted };
    font-size: 0.8rem;
    transition: color 0.15s, background 0.15s;
    min-height: 2.75rem;

    &:hover {
        color: ${ ( { theme, $confirming } ) => $confirming ? theme.colors.error : theme.colors.text };
        background: ${ ( { theme } ) => theme.colors.surface_hover };
    }
`

const DownloadAppLink = styled( Link )`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    width: 100%;
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } ${ theme.spacing.sm }` };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    color: ${ ( { theme } ) => theme.colors.accent };
    font-size: 0.8rem;
    text-decoration: none;
    transition: color 0.15s, background 0.15s;
    min-height: 2.75rem;

    &:hover {
        background: ${ ( { theme } ) => theme.colors.surface_hover };
    }
`

const DownloadAppLabel = styled.span`
    display: flex;
    flex-direction: column;
    line-height: 1.2;
`

const DownloadAppSubtext = styled.span`
    font-size: 0.65rem;
    opacity: 0.7;
    font-weight: 400;
`

const spin = keyframes`
    from { transform: rotate( 0deg ); }
    to { transform: rotate( 360deg ); }
`

const CheckUpdateButton = styled.button`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    width: 100%;
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } ${ theme.spacing.sm }` };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    color: ${ ( { theme } ) => theme.colors.text_muted };
    font-size: 0.8rem;
    transition: color 0.15s, background 0.15s;
    min-height: 2.75rem;

    &:hover:not( :disabled ) {
        color: ${ ( { theme } ) => theme.colors.text };
        background: ${ ( { theme } ) => theme.colors.surface_hover };
    }

    &:disabled {
        opacity: 0.7;
        cursor: default;
    }
`

const SpinnerIcon = styled( LoaderCircle )`
    animation: ${ spin } 1s linear infinite;
`

const is_electron = () => !!window.electronAPI?.native_inference

/**
 * Sidebar with chat history, new chat button, and mobile backdrop.
 * Delete uses a "click again to confirm" pattern with visible text feedback.
 * @param {Object} props
 * @param {boolean} props.collapsed - Whether sidebar is collapsed
 * @param {Function} props.on_toggle - Handler for toggling sidebar
 * @param {Function} props.on_new_chat - Handler for creating new chat
 * @param {Array} props.conversations - Array of conversation objects
 * @param {Function} props.on_export - Handler for exporting a conversation
 * @param {Function} props.on_delete - Handler for deleting a conversation
 * @param {Function} props.on_delete_all - Handler for wiping all conversations
 * @param {Array} props.cached_models - Array of cached model metadata (for mobile model selector)
 * @param {string} props.active_model_id - Currently active model ID
 * @param {boolean} props.is_model_switching - Whether a model switch is in progress
 * @param {Function} props.on_model_switch - Handler for model switching
 * @param {Function} props.on_settings_open - Handler for opening settings (model management)
 * @returns {JSX.Element}
 */
export default function Sidebar( {
    collapsed, on_toggle, on_new_chat, conversations = [], on_export, on_delete, on_delete_all,
    cached_models, active_model_id, is_model_switching, on_model_switch, on_settings_open,
    on_models_purged,
} ) {

    const { t } = useTranslation( 'pages' )
    const navigate = useNavigate()
    const { id: active_id } = useParams()
    const [ confirming_delete, set_confirming_delete ] = useState( null )
    const [ confirming_wipe, set_confirming_wipe ] = useState( false )

    // Check-for-updates state (Electron only)
    const [ check_status, set_check_status ] = useState( `idle` )
    const status_ref = useRef( `idle` )
    const timer_ref = useRef( null )

    // Keep ref in sync so IPC callbacks see the latest status
    const update_status = ( next ) => {
        status_ref.current = next
        set_check_status( next )
    }

    // Reset to idle after a brief delay (for transient states)
    const reset_after_delay = ( ms = 3000 ) => {
        clearTimeout( timer_ref.current )
        timer_ref.current = setTimeout( () => update_status( `idle` ), ms )
    }

    // Subscribe to updater IPC events for feedback
    useEffect( () => {

        if( !is_electron() ) return

        const unsub_not_available = window.electronAPI.updater.on_update_not_available( () => {
            if( status_ref.current === `checking` ) {
                update_status( `up_to_date` )
                reset_after_delay()
                toast.success( t( `update_toast_up_to_date` ) )
            }
        } )

        const unsub_available = window.electronAPI.updater.on_update_available( ( data ) => {
            // The existing UpdateBanner handles the download flow — just notify and reset
            update_status( `idle` )
            toast.success( t( `update_toast_available`, { version: data?.version || `` } ) )
        } )

        const unsub_error = window.electronAPI.updater.on_update_error( ( data ) => {
            if( status_ref.current === `checking` ) {
                update_status( `failed` )
                reset_after_delay()
                toast.error( data?.message || t( `update_toast_error` ) )
            }
        } )

        return () => {
            unsub_not_available()
            unsub_available()
            unsub_error()
            clearTimeout( timer_ref.current )
        }

    }, [] )

    const handle_check_for_updates = async () => {
        if( check_status === `checking` ) return
        update_status( `checking` )
        const result = await window.electronAPI.updater.check_for_updates()
        // Handle errors returned as plain objects (not thrown)
        if( result?.status === `error` ) {
            update_status( `failed` )
            reset_after_delay()
            toast.error( result.message || t( `update_toast_error` ) )
        }
    }

    // On mobile, collapse sidebar after navigation
    const close_on_mobile = () => {
        if( window.innerWidth <= 768 && on_toggle ) on_toggle()
    }

    const handle_new_chat = () => {
        if( on_new_chat ) on_new_chat()
        navigate( `/chat` )
        close_on_mobile()
    }

    const handle_click_conversation = ( id ) => {
        navigate( `/chat/${ id }` )
        close_on_mobile()
    }

    const handle_export = ( e, conversation ) => {
        e.stopPropagation()
        if( on_export ) on_export( conversation )
    }

    const handle_delete = ( e, id ) => {
        e.stopPropagation()
        if( confirming_delete === id ) {
            // Second click confirms
            if( on_delete ) on_delete( id )
            set_confirming_delete( null )
        } else {
            // First click — ask to confirm
            set_confirming_delete( id )
            // Reset after 5 seconds if not confirmed
            setTimeout( () => set_confirming_delete( null ), 5000 )
        }
    }

    const handle_wipe = () => {
        if( confirming_wipe ) {
            // Second click confirms
            if( on_delete_all ) on_delete_all()
            set_confirming_wipe( false )
        } else {
            // First click — ask to confirm
            set_confirming_wipe( true )
            setTimeout( () => set_confirming_wipe( false ), 5000 )
        }
    }

    return <>

        { /* Mobile backdrop — dims content behind sidebar */ }
        <Backdrop $visible={ !collapsed } onClick={ on_toggle } data-testid="sidebar-backdrop" />

        <SidebarContainer $collapsed={ collapsed }>

            <SidebarHeader>
                <NewChatButton
                    data-testid="new-chat-btn"
                    onClick={ handle_new_chat }
                >
                    <Plus size={ 16 } />
                    { t( 'new_chat' ) }
                </NewChatButton>

                <CollapseButton onClick={ on_toggle } aria-label={ t( 'common:aria_toggle_sidebar' ) }>
                    { collapsed ? <PanelLeft size={ 18 } /> : <PanelLeftClose size={ 18 } /> }
                </CollapseButton>
            </SidebarHeader>

            <MobileModelSection>
                <ModelSelector
                    cached_models={ cached_models }
                    active_model_id={ active_model_id }
                    is_switching={ is_model_switching }
                    on_switch={ on_model_switch }
                    on_open_settings={ on_settings_open }
                    on_after_select={ close_on_mobile }
                    on_models_purged={ on_models_purged }
                />
            </MobileModelSection>

            <ConversationListContainer>

                { conversations.length === 0 ?
                    <EmptyState>
                        { t( 'empty_conversations' ) }
                    </EmptyState>
                    :
                    conversations.map( ( conv ) =>
                        <ConversationItem
                            key={ conv.id }
                            data-testid={ `sidebar-conversation-${ conv.id }` }
                            $active={ conv.id === active_id }
                            role="button"
                            tabIndex={ 0 }
                            onClick={ () => handle_click_conversation( conv.id ) }
                            onKeyDown={ ( e ) => {
                                if( e.key === `Enter` ) handle_click_conversation( conv.id ) 
                            } }
                        >
                            <ConversationTitle>
                                { truncate( conv.title, 40 ) }
                            </ConversationTitle>

                            <ConversationActions
                                className="conv-actions"
                                $visible={ confirming_delete === conv.id }
                            >
                                { confirming_delete !== conv.id && <ActionIcon
                                    data-testid={ `sidebar-export-${ conv.id }` }
                                    onClick={ ( e ) => handle_export( e, conv ) }
                                    aria-label={ t( 'common:aria_export_conversation' ) }
                                    title={ t( 'common:export' ) }
                                >
                                    <Download size={ 14 } />
                                </ActionIcon> }
                                <ActionIcon
                                    data-testid={ `sidebar-delete-${ conv.id }` }
                                    onClick={ ( e ) => handle_delete( e, conv.id ) }
                                    aria-label={ confirming_delete === conv.id ? t( 'common:aria_confirm_delete' ) : t( 'common:aria_delete_conversation' ) }
                                    title={ confirming_delete === conv.id ? t( 'click_to_confirm' ) : t( 'common:delete' ) }
                                    $confirming={ confirming_delete === conv.id }
                                >
                                    <Trash2 size={ 14 } />
                                    { confirming_delete === conv.id && t( 'delete_question' ) }
                                </ActionIcon>
                            </ConversationActions>
                        </ConversationItem>
                    ) }

            </ConversationListContainer>

            { /* Wipe history — only shown when there are conversations */ }
            { conversations.length > 0 && <SidebarFooter>
                <WipeButton
                    data-testid="wipe-history-btn"
                    onClick={ handle_wipe }
                    $confirming={ confirming_wipe }
                    aria-label={ confirming_wipe ? t( 'common:aria_confirm_wipe_history' ) : t( 'common:aria_wipe_history' ) }
                >
                    <Trash size={ 14 } />
                    { confirming_wipe ? t( 'settings:click_again_to_confirm' ) : t( 'wipe_history' ) }
                </WipeButton>
            </SidebarFooter> }

            { /* Electron: check for updates — Web: download app promo */ }
            { is_electron()
                ? <SidebarFooter>
                    <CheckUpdateButton
                        data-testid="check-for-updates-btn"
                        onClick={ handle_check_for_updates }
                        disabled={ check_status === `checking` }
                        aria-label={ t( 'common:aria_check_for_updates' ) }
                    >
                        { check_status === `checking` && <><SpinnerIcon size={ 14 } /> { t( 'checking_updates' ) }</> }
                        { check_status === `up_to_date` && <><CheckCircle size={ 14 } /> { t( 'up_to_date' ) }</> }
                        { check_status === `failed` && <><RefreshCw size={ 14 } /> { t( 'check_failed' ) }</> }
                        { check_status === `idle` && <><RefreshCw size={ 14 } /> { t( 'check_for_updates' ) }</> }
                    </CheckUpdateButton>
                </SidebarFooter>
                : <SidebarFooter>
                    <DownloadAppLink to="/get-app" data-testid="sidebar-download-app">
                        <Monitor size={ 14 } />
                        <DownloadAppLabel>
                            { t( 'download_app' ) }
                            <DownloadAppSubtext>{ t( 'download_app_subtext' ) }</DownloadAppSubtext>
                        </DownloadAppLabel>
                    </DownloadAppLink>
                </SidebarFooter> }

        </SidebarContainer>

    </>

}
