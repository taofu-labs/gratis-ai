import { useState, useRef, useEffect } from 'react'
import styled, { useTheme } from 'styled-components'
import { ChevronDown, Check, Plus, Settings, LoaderCircle, AlertTriangle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { format_file_size, can_fit_in_memory, get_model_by_id } from '../../utils/model_catalog'
import use_device_capabilities from '../../hooks/use_device_capabilities'

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
            const available = window.innerHeight - rect.top - 16
            set_dropdown_max_height( Math.max( 150, available ) )
        }

        compute_max_height()

        window.addEventListener( `resize`, compute_max_height )
        return () => window.removeEventListener( `resize`, compute_max_height )

    }, [ is_open ] )

    // Find the active model's display name
    const active_model = cached_models.find( ( m ) => m.id === active_model_id )
    const display_name = is_switching ? t( `common:loading` ) : active_model?.name || t( `no_model` )

    const handle_select = ( model_id ) => {
        set_is_open( false )
        if( model_id !== active_model_id && on_switch ) {
            on_switch( model_id )
        }
        if( on_after_select ) on_after_select()
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
