import { useState, useEffect } from 'react'
import styled from 'styled-components'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import BasicSettings from './BasicSettings'
import AdvancedSettings from './AdvancedSettings'
import ModelsSettings from './ModelsSettings'
import use_settings from '../../hooks/use_settings'
import { EVENTS } from '../../utils/branding'

const Overlay = styled.div`
    position: fixed;
    inset: 0;
    background: ${ ( { theme } ) => theme.colors.modal_overlay };
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
`

const Modal = styled.div`
    background: ${ ( { theme } ) => theme.colors.background };
    border-radius: ${ ( { theme } ) => theme.border_radius.lg };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    box-shadow: ${ ( { theme } ) => theme.mode === `dark`
        ? `0 4px 24px rgba( 0, 0, 0, 0.4 )`
        : `0 4px 24px rgba( 0, 0, 0, 0.1 )` };
    width: min( 560px, 90vw );
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
`

const Header = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: ${ ( { theme } ) => theme.spacing.md };
`

const Title = styled.h2`
    font-size: 1.1rem;
    font-weight: 600;
`

const CloseButton = styled.button`
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

const TabBar = styled.div`
    display: flex;
    padding: ${ ( { theme } ) => `0 ${ theme.spacing.md }` };
`

const Tab = styled.button`
    flex: 1;
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.md }` };
    font-size: 0.85rem;
    font-weight: ${ ( { $active } ) => $active ? `600` : `400` };
    color: ${ ( { theme, $active } ) => $active ? theme.colors.text : theme.colors.text_muted };
    transition: color 0.15s;

    &:hover {
        color: ${ ( { theme } ) => theme.colors.text };
    }
`

const Body = styled.div`
    flex: 1;
    overflow-y: auto;
    padding: ${ ( { theme } ) => theme.spacing.md };
`

/**
 * Settings modal with three tabs
 * @param {Object} props
 * @param {boolean} props.is_open - Whether the modal is open
 * @param {Function} props.on_close - Handler for closing the modal
 * @param {Function} [props.on_model_switch] - Handler for switching models
 * @returns {JSX.Element|null}
 */
export default function SettingsModal( { is_open, on_close, on_model_switch } ) {

    const [ active_tab, set_active_tab ] = useState( `basic` )
    const { settings, update_setting } = use_settings()
    const { t } = useTranslation( `settings` )

    const TABS = [
        { id: `basic`, label: t( `tab_basic` ) },
        { id: `advanced`, label: t( `tab_advanced` ) },
        { id: `models`, label: t( `tab_models` ) },
    ]

    // Listen for global close-modal events (Escape key)
    useEffect( () => {

        const handle_close = () => {
            if( is_open ) on_close()
        }
        window.addEventListener( EVENTS.close_modal, handle_close )
        return () => window.removeEventListener( EVENTS.close_modal, handle_close )

    }, [ is_open, on_close ] )

    if( !is_open ) return null

    // Close on backdrop click
    const handle_overlay_click = ( e ) => {
        if( e.target === e.currentTarget ) on_close()
    }

    return <Overlay data-testid="settings-modal" onClick={ handle_overlay_click }>
        <Modal>

            <Header>
                <Title>{ t( `title` ) }</Title>
                <CloseButton onClick={ on_close } aria-label={ t( `common:aria_close_settings` ) }>
                    <X size={ 18 } />
                </CloseButton>
            </Header>

            <TabBar>
                { TABS.map( ( tab ) =>
                    <Tab
                        key={ tab.id }
                        data-testid={ `settings-tab-${ tab.id }` }
                        $active={ active_tab === tab.id }
                        onClick={ () => set_active_tab( tab.id ) }
                    >
                        { tab.label }
                    </Tab>
                ) }
            </TabBar>

            <Body>
                { active_tab === `basic` &&
                    <BasicSettings
                        system_prompt={ settings.system_prompt }
                        on_system_prompt_change={ ( v ) => update_setting( `system_prompt`, v ) }
                    /> }

                { active_tab === `advanced` &&
                    <AdvancedSettings
                        settings={ settings }
                        on_change={ update_setting }
                    /> }

                { active_tab === `models` &&
                    <ModelsSettings on_close={ on_close } on_model_switch={ on_model_switch } /> }
            </Body>

        </Modal>
    </Overlay>

}
