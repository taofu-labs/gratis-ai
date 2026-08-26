import styled from 'styled-components'
import { Settings, PanelLeft, ArrowLeftRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ModelSelector from './ModelSelector'
import LanguageSelector from './LanguageSelector'

const Bar = styled.header`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.md }` };
    background: ${ ( { theme } ) => theme.colors.background };
    border-bottom: 1px solid ${ ( { theme } ) => theme.colors.border_subtle };
    height: 56px;
    flex-shrink: 0;
`

const LeftSection = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    flex: 1;
    min-width: 0;
`

const RightSection = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
`

const IconButton = styled.button`
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

const ChangeModelButton = styled.button`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } ${ theme.spacing.sm }` };
    font-size: 0.75rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    transition: color 0.15s;
    white-space: nowrap;

    &:hover { color: ${ ( { theme } ) => theme.colors.text_secondary }; }
`

// Hide model selector on mobile — it lives in the sidebar instead
const DesktopOnly = styled.span`
    display: contents;
    @media ( max-width: ${ ( { theme } ) => theme.breakpoints.mobile } ) {
        display: none;
    }
`

// Hide "Change Model" text label on mobile, keep the icon
const ChangeModelLabel = styled.span`
    @media ( max-width: ${ ( { theme } ) => theme.breakpoints.mobile } ) {
        display: none;
    }
`

/**
 * Top navigation bar with model selector and settings
 * @param {Object} props
 * @param {Function} props.on_settings_open - Handler for opening settings
 * @param {boolean} props.sidebar_collapsed - Whether sidebar is currently collapsed
 * @param {Function} props.on_toggle_sidebar - Handler for toggling sidebar visibility
 * @param {Array} props.cached_models - Array of cached model metadata
 * @param {string} props.active_model_id - Currently active model ID
 * @param {boolean} props.is_model_switching - Whether a model switch is in progress
 * @param {Function} props.on_model_switch - Handler for model switching
 * @returns {JSX.Element}
 */
export default function TopBar( {
    on_settings_open,
    sidebar_collapsed,
    on_toggle_sidebar,
    cached_models,
    active_model_id,
    is_model_switching,
    on_model_switch,
    on_models_purged,
} ) {

    const navigate = useNavigate()
    const { t } = useTranslation( `pages` )

    return <Bar>

        { /* Left: sidebar toggle + model selector + change model */ }
        <LeftSection>
            { sidebar_collapsed && <IconButton
                data-testid="sidebar-open-btn"
                onClick={ on_toggle_sidebar }
                aria-label={ t( `common:aria_open_sidebar` ) }
            >
                <PanelLeft size={ 18 } />
            </IconButton> }
            <DesktopOnly>
                <ModelSelector
                    cached_models={ cached_models }
                    active_model_id={ active_model_id }
                    is_switching={ is_model_switching }
                    on_switch={ on_model_switch }
                    on_open_settings={ on_settings_open }
                    on_models_purged={ on_models_purged }
                />
            </DesktopOnly>
            <ChangeModelButton
                data-testid="change-model-btn"
                onClick={ () => navigate( `/select-model` ) }
                aria-label={ t( `common:aria_change_model` ) }
            >
                <ArrowLeftRight size={ 14 } />
                <ChangeModelLabel>{ t( `change_model` ) }</ChangeModelLabel>
            </ChangeModelButton>
        </LeftSection>

        { /* Right: language + settings */ }
        <RightSection>
            <LanguageSelector />

            <IconButton
                data-testid="settings-btn"
                onClick={ on_settings_open }
                aria-label={ t( `common:aria_open_settings` ) }
            >
                <Settings size={ 18 } />
            </IconButton>
        </RightSection>

    </Bar>

}
