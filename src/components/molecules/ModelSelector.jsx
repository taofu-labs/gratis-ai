import { useState, useRef, useEffect } from 'react'
import styled, { useTheme } from 'styled-components'
import { ChevronDown, Check, Plus, Settings, LoaderCircle, AlertTriangle, Cloud, Lock, Zap } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { format_file_size, can_fit_in_memory, get_model_by_id } from '../../utils/model_catalog'
import use_device_capabilities from '../../hooks/use_device_capabilities'
import use_pro_store from '../../stores/pro_store'
import { CLOUD_MODELS, get_cloud_model } from '../../providers/gratis_provider'

const Container = styled.div`
    position: relative;
    min-width: 0;
`

const Trigger = styled.button`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } ${ theme.spacing.sm }` };
    font-size: 0.85rem;
    color: ${ ( { theme } ) => theme.colors.text };
    max-width: min( 200px, 100% );
    transition: opacity 0.15s;
    min-height: 2.75rem;

    &:hover { opacity: 0.7; }
`

const ModelName = styled.span`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

const Dropdown = styled.div`
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    min-width: 220px;
    max-height: min( 400px, 60vh );

    @media ( max-width: ${ ( { theme } ) => theme.breakpoints.mobile } ) {
        position: fixed;
        top: 3.5rem;
        left: ${ ( { theme } ) => theme.spacing.md };
        right: ${ ( { theme } ) => theme.spacing.md };
        min-width: 0;
    }
    overflow-y: auto;
    background: ${ ( { theme } ) => theme.colors.background };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.lg };
    box-shadow: ${ ( { theme } ) => theme.mode === `dark`
        ? `0 2px 8px rgba( 0, 0, 0, 0.3 )`
        : `0 2px 8px rgba( 0, 0, 0, 0.08 )` };
    z-index: 500;
`

const ModelOption = styled.button`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    width: 100%;
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.md }` };
    text-align: left;
    font-size: 0.85rem;
    color: ${ ( { theme } ) => theme.colors.text };
    transition: background 0.15s;
    min-height: 2.75rem;

    &:hover {
        background: ${ ( { theme } ) => theme.colors.surface_hover };
    }

    &:disabled {
        cursor: not-allowed;
        opacity: 0.55;
    }
`

const ModelInfo = styled.div`
    flex: 1;
    min-width: 0;
`

const ModelLabel = styled.div`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
`

const ModelMeta = styled.div`
    font-size: 0.75rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

const Divider = styled.div`
    height: 1px;
    background: ${ ( { theme } ) => theme.colors.border_subtle };
    margin: ${ ( { theme } ) => `${ theme.spacing.xs } 0` };
`

const ActionOption = styled( ModelOption )`
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    font-size: 0.8rem;
`

const GroupLabel = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.md } ${ theme.spacing.xs }` };
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

const ProBadge = styled.span`
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.0625rem 0.375rem;
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    background: ${ ( { theme } ) => `${ theme.colors.accent }26` };
    color: ${ ( { theme } ) => theme.colors.accent_text };
    letter-spacing: 0;
    text-transform: none;
`

const Footnote = styled.div`
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } ${ theme.spacing.md } ${ theme.spacing.sm }` };
    font-size: 0.75rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };

    button {
        color: ${ ( { theme } ) => theme.colors.accent_text };
        text-decoration: underline;
        font-size: inherit;
        min-height: 1.5rem;
    }
`

const NoModelHint = styled.div`
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.md }` };
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    text-align: center;
    line-height: 1.4;
`

/**
 * Model selector dropdown in the TopBar — the single model control on every viewport.
 * Shows just model name and download size — technical details
 * (quantization, parameters) are hidden to keep it clean.
 * @param {Object} props
 * @param {Array} props.cached_models - Array of cached model metadata objects
 * @param {string} props.active_model_id - Currently active model ID
 * @param {boolean} props.is_switching - Whether a model switch is in progress
 * @param {Function} props.on_switch - Handler for switching models
 * @param {Function} props.on_open_settings - Handler for opening models settings
 * @param {Function} [props.on_after_select] - Optional callback fired after a model is selected (e.g. to close sidebar)
 * @returns {JSX.Element}
 */
export default function ModelSelector( { cached_models = [], active_model_id, is_switching, on_switch, on_open_settings, on_after_select } ) {

    const [ is_open, set_is_open ] = useState( false )
    const [ dropdown_max_height, set_dropdown_max_height ] = useState( undefined )
    const container_ref = useRef( null )
    const dropdown_ref = useRef( null )
    const navigate = useNavigate()
    const theme = useTheme()
    const { t } = useTranslation( `models` )
    const { max_model_bytes, is_detecting } = use_device_capabilities()
    const { available: pro_available, show_pro_models, signed_in, open_explainer } = use_pro_store()
    const show_cloud = pro_available && show_pro_models

    // Close dropdown on click outside or Escape key
    useEffect( () => {

        if( !is_open ) return

        const handle_click = ( e ) => {
            if( container_ref.current && !container_ref.current.contains( e.target ) ) {
                set_is_open( false )
            }
        }

        const handle_keydown = ( e ) => {
            if( e.key === `Escape` ) {
                e.stopPropagation()
                set_is_open( false )
            }
        }

        document.addEventListener( `mousedown`, handle_click )
        document.addEventListener( `keydown`, handle_keydown, true )
        return () => {
            document.removeEventListener( `mousedown`, handle_click )
            document.removeEventListener( `keydown`, handle_keydown, true )
        }

    }, [ is_open ] )

    // Dynamically compute dropdown max-height based on available viewport space
    useEffect( () => {

        if( !is_open || !dropdown_ref.current ) return

        const compute_max_height = () => {
            const rect = dropdown_ref.current.getBoundingClientRect()
            const available = ( window.visualViewport?.height ?? window.innerHeight ) - rect.top - 16
            set_dropdown_max_height( Math.max( 150, available ) )
        }

        compute_max_height()

        // The visual viewport also shrinks for the touch keyboard
        const target = window.visualViewport || window
        target.addEventListener( `resize`, compute_max_height )
        return () => target.removeEventListener( `resize`, compute_max_height )

    }, [ is_open ] )

    // Find the active model's display name
    const active_model = cached_models.find( ( m ) => m.id === active_model_id )
    const active_cloud = get_cloud_model( active_model_id )
    const display_name = is_switching ? t( `common:loading` ) : active_model?.name || active_cloud && t( active_cloud.name_key ) || t( `no_model` )

    const handle_select = ( model_id ) => {
        set_is_open( false )
        if( model_id !== active_model_id && on_switch ) {
            on_switch( model_id )
        }
        if( on_after_select ) on_after_select()
    }

    // Locked until signed in: the explainer says what Pro is and that free stays free
    const handle_cloud = ( model_id ) => {
        if( signed_in ) return handle_select( model_id )
        set_is_open( false )
        open_explainer()
    }

    const handle_explain = () => {
        set_is_open( false )
        open_explainer()
    }

    const handle_add = () => {
        set_is_open( false )
        navigate( `/select-model` )
    }

    const handle_manage = () => {
        set_is_open( false )
        if( on_open_settings ) on_open_settings()
    }

    return <Container ref={ container_ref }>

        <Trigger
            data-testid="model-selector-dropdown"
            data-focus-fallback
            aria-expanded={ is_open }
            title={ display_name }
            onClick={ () => set_is_open( !is_open ) }
        >
            { is_switching ? <LoaderCircle size={ 14 } /> : null }
            <ModelName>{ display_name }</ModelName>
            <ChevronDown size={ 14 } />
        </Trigger>

        { is_open &&
            <Dropdown ref={ dropdown_ref } style={ dropdown_max_height !== undefined ? { maxHeight: dropdown_max_height } : undefined }>

                { show_cloud && <GroupLabel>{ t( `pro:model_menu_local` ) }</GroupLabel> }

                { cached_models.length === 0 ?
                    <NoModelHint>
                        { t( `no_models_hint` ) }
                    </NoModelHint>
                    :
                    cached_models.map( ( model ) => {
                        const fit_model = get_model_by_id( model.id ) || model
                        const too_large = !is_detecting
                            && !can_fit_in_memory( fit_model, max_model_bytes )
                        return <ModelOption
                            key={ model.id }
                            data-testid={ `model-option-${ model.id }` }
                            onClick={ () => handle_select( model.id ) }
                            disabled={ too_large }
                        >
                            { model.id === active_model_id ?
                                <Check size={ 14 } style={ { flexShrink: 0 } } />
                                :
                                <div style={ { width: 14 } } /> }
                            <ModelInfo>
                                <ModelLabel>
                                    { model.name }
                                </ModelLabel>
                                <ModelMeta>
                                    { format_file_size( model.file_size_bytes ) }
                                    { too_large ? ` — ${ t( `does_not_fit` ) }` : `` }
                                </ModelMeta>
                            </ModelInfo>
                            { too_large && <AlertTriangle size={ 12 } style={ { color: theme.colors.warning, flexShrink: 0 } } /> }
                        </ModelOption>
                    } ) }

                { show_cloud && <>
                    <Divider />
                    <GroupLabel>
                        { t( `pro:model_menu_cloud` ) }
                        <ProBadge><Zap size={ 11 } />{ t( `pro:pro` ) }</ProBadge>
                    </GroupLabel>
                    { CLOUD_MODELS.map( ( model ) => <ModelOption
                        key={ model.id }
                        data-testid={ `model-option-${ model.id }` }
                        onClick={ () => handle_cloud( model.id ) }
                    >
                        { model.id === active_model_id ?
                            <Check size={ 14 } style={ { flexShrink: 0 } } />
                            :
                            <Cloud size={ 14 } style={ { flexShrink: 0, color: theme.colors.text_muted } } /> }
                        <ModelInfo>
                            <ModelLabel>{ t( model.name_key ) }</ModelLabel>
                            <ModelMeta>{ t( model.hint_key ) }</ModelMeta>
                        </ModelInfo>
                        { !signed_in && <Lock size={ 12 } aria-label={ t( `pro:sign_in` ) } style={ { color: theme.colors.text_muted, flexShrink: 0 } } /> }
                    </ModelOption> ) }
                    <Footnote>
                        { t( `pro:model_menu_footer` ) } <button type="button" data-testid="model-whats-pro-btn" onClick={ handle_explain }>{ t( `pro:whats_pro` ) }</button>
                    </Footnote>
                </> }

                <Divider />

                <ActionOption data-testid="model-add-btn" onClick={ handle_add }>
                    <Plus size={ 14 } />
                    { t( `add_model` ) }
                </ActionOption>

                <ActionOption data-testid="model-manage-btn" onClick={ handle_manage }>
                    <Settings size={ 14 } />
                    { t( `manage_models` ) }
                </ActionOption>

            </Dropdown> }

    </Container>

}
