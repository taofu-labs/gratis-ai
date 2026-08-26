import { useState, useEffect, useCallback } from 'react'
import styled from 'styled-components'
import TopBar from './TopBar'
import Sidebar from './Sidebar'
import SettingsModal from './SettingsModal'
import UpdateBanner from '../atoms/UpdateBanner'
import UpdateModal from '../atoms/UpdateModal'
import use_auto_updater from '../../hooks/use_auto_updater'
import { EVENTS } from '../../utils/branding'

const LayoutContainer = styled.div`
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
`

const MainArea = styled.div`
    display: flex;
    flex: 1;
    overflow: hidden;
    position: relative;
`

const ContentArea = styled.main`
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
`

/**
 * Shell layout wrapping sidebar + content with top bar
 * @param {Object} props
 * @param {React.ReactNode} props.children - Page content
 * @param {Function} props.on_new_chat - Handler for new chat creation
 * @param {Array} props.conversations - Array of conversation objects for sidebar
 * @param {Function} props.on_export - Handler for exporting a conversation
 * @param {Function} props.on_delete - Handler for deleting a conversation
 * @param {Function} props.on_delete_all - Handler for wiping all conversations
 * @param {Array} props.cached_models - Cached model metadata for model selector
 * @param {string} props.active_model_id - Currently active model ID
 * @param {boolean} props.is_model_switching - Whether model switch is in progress
 * @param {Function} props.on_model_switch - Handler for switching models
 * @returns {JSX.Element}
 */
export default function AppLayout( {
    children, on_new_chat,
    conversations, on_export, on_delete, on_delete_all,
    cached_models, active_model_id, is_model_switching, on_model_switch,
    on_models_purged,
} ) {

    const updater = use_auto_updater()

    const [ sidebar_collapsed, set_sidebar_collapsed ] = useState( () =>
        typeof window !== `undefined` && window.innerWidth < 768
    )
    const [ settings_open, set_settings_open ] = useState( false )

    // Respond to viewport changes
    useEffect( () => {

        const handle_resize = () => {
            if( window.innerWidth < 768 ) set_sidebar_collapsed( true )
        }

        window.addEventListener( `resize`, handle_resize )
        return () => window.removeEventListener( `resize`, handle_resize )

    }, [] )

    // Listen for global keyboard shortcut events
    useEffect( () => {

        const handle_open_settings = () => set_settings_open( true )
        const handle_toggle_sidebar = () => set_sidebar_collapsed( prev => !prev )

        window.addEventListener( EVENTS.open_settings, handle_open_settings )
        window.addEventListener( EVENTS.toggle_sidebar, handle_toggle_sidebar )
        return () => {
            window.removeEventListener( EVENTS.open_settings, handle_open_settings )
            window.removeEventListener( EVENTS.toggle_sidebar, handle_toggle_sidebar )
        }

    }, [] )

    const toggle_sidebar = () => set_sidebar_collapsed( prev => !prev )
    const close_settings = useCallback( () => set_settings_open( false ), [] )

    return <LayoutContainer>

        <TopBar
            on_settings_open={ () => set_settings_open( true ) }
            sidebar_collapsed={ sidebar_collapsed }
            on_toggle_sidebar={ toggle_sidebar }
            cached_models={ cached_models }
            active_model_id={ active_model_id }
            is_model_switching={ is_model_switching }
            on_model_switch={ on_model_switch }
            on_models_purged={ on_models_purged }
        />

        <UpdateBanner
            available_update={ updater.available_update }
            is_downloading={ updater.is_downloading }
            download_progress={ updater.download_progress }
        />

        <UpdateModal
            available_update={ updater.available_update }
            is_ready_to_install={ updater.is_ready_to_install }
            dismissed={ updater.dismissed }
            on_install={ updater.install_update }
            on_dismiss={ updater.dismiss }
        />

        <MainArea>
            <Sidebar
                collapsed={ sidebar_collapsed }
                on_toggle={ toggle_sidebar }
                on_new_chat={ on_new_chat }
                conversations={ conversations }
                on_export={ on_export }
                on_delete={ on_delete }
                on_delete_all={ on_delete_all }
                cached_models={ cached_models }
                active_model_id={ active_model_id }
                is_model_switching={ is_model_switching }
                on_model_switch={ on_model_switch }
                on_settings_open={ () => set_settings_open( true ) }
                on_models_purged={ on_models_purged }
            />
            <ContentArea>
                { children }
            </ContentArea>
        </MainArea>

        <SettingsModal
            is_open={ settings_open }
            on_close={ close_settings }
            on_model_switch={ on_model_switch }
        />

    </LayoutContainer>

}
