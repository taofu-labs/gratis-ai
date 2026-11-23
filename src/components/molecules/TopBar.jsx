import styled from 'styled-components'
import { Settings, PanelLeft, ArrowLeftRight, Zap } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ModelSelector from './ModelSelector'
import LanguageSelector from './LanguageSelector'
import BrandMark from '../atoms/BrandMark'
import use_llm_store from '../../stores/llm_store'
import use_pro_store from '../../stores/pro_store'

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

// Wordmark doubles as the home link
const Home = styled( Link )`
    display: flex;
    align-items: center;
    min-height: 2.75rem;
    padding: 0 ${ ( { theme } ) => theme.spacing.xs };
    margin-right: ${ ( { theme } ) => theme.spacing.xs };
    color: ${ ( { theme } ) => theme.colors.text };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };

    @media ( max-width: ${ ( { theme } ) => theme.breakpoints.mobile } ) {
        svg { height: 1.25rem; }
    }
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
    min-height: 2.75rem;
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } ${ theme.spacing.sm }` };
    font-size: 0.75rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    transition: color 0.15s;
    white-space: nowrap;

    &:hover { color: ${ ( { theme } ) => theme.colors.text_secondary }; }

    /* Phones: the model name itself is the control (its menu has "Add model") */
    @media ( max-width: ${ ( { theme } ) => theme.breakpoints.mobile } ) {
        display: none;
    }
`

// Quiet outlined pill; the bolt carries the brand colour
const ProButton = styled.button`
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 2rem;
    padding: 0 0.75rem;
    margin-right: ${ ( { theme } ) => theme.spacing.xs };
    font-size: 0.85rem;
    font-weight: 600;
    color: ${ ( { theme } ) => theme.colors.text };
    border: 1px solid ${ ( { theme } ) => theme.colors.border_control };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    transition: border-color 0.15s, background-color 0.15s;

    svg { color: ${ ( { theme } ) => theme.colors.accent_text }; }

    &:hover {
        border-color: ${ ( { theme } ) => theme.colors.border_strong };
        background: ${ ( { theme } ) => theme.colors.surface_hover };
    }

    /* Phones: bolt only, so the model name keeps its room */
    @media ( max-width: ${ ( { theme } ) => theme.breakpoints.mobile } ) {
        padding: 0 0.5rem;
        margin-right: 0;
        span { display: none; }
    }

    /* Invisible 44px hit area around the 32px face */
    position: relative;
    &::before { content: ''; position: absolute; inset: -6px -2px; }
`

/**
 * Top navigation bar with model selector and settings
 * @param {Object} props
 * @param {boolean} [props.inert] - Take the bar out of focus/a11y (e.g. behind the phone drawer)
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
    inert,
    on_settings_open,
    sidebar_collapsed,
    on_toggle_sidebar,
    cached_models,
    active_model_id,
    is_model_switching,
    on_model_switch,
} ) {

    const navigate = useNavigate()
    const { t } = useTranslation( `pages` )

    // While a model loads nothing is "loaded" yet; name the incoming model instead of "No model"
    const loading_model_id = use_llm_store( s => s._loading_model_id )
    const { available: pro_available, open_explainer } = use_pro_store()

    return <Bar inert={ inert }>

        { /* Left: sidebar toggle + model selector + change model */ }
        <LeftSection>
            { sidebar_collapsed && <IconButton
                data-testid="sidebar-open-btn"
                onClick={ on_toggle_sidebar }
                aria-label={ t( `common:aria_open_sidebar` ) }
            >
                <PanelLeft size={ 18 } />
            </IconButton> }
            <Home to="/" aria-label={ t( `common:aria_home` ) }>
                <BrandMark height="1.625rem" />
            </Home>
            <ModelSelector
                cached_models={ cached_models }
                active_model_id={ active_model_id || loading_model_id }
                is_switching={ is_model_switching }
                on_switch={ on_model_switch }
                on_open_settings={ on_settings_open }
            />
            <ChangeModelButton
                data-testid="change-model-btn"
                onClick={ () => navigate( `/select-model` ) }
                aria-label={ t( `common:aria_change_model` ) }
            >
                <ArrowLeftRight size={ 14 } />
                { t( `change_model` ) }
            </ChangeModelButton>
        </LeftSection>

        { /* Right: language + settings */ }
        <RightSection>
            { pro_available && <ProButton
                data-testid="pro-btn"
                onClick={ open_explainer }
                aria-label={ t( `pro:aria_open_pro` ) }
            >
                <Zap size={ 14 } />
                <span>{ t( `pro:pro` ) }</span>
            </ProButton> }
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
