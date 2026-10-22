import { useState, useId } from 'react'
import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { log } from 'mentie'
import { useTranslation } from 'react-i18next'
import { format_file_size } from '../../utils/model_catalog'
import use_model_manager from '../../hooks/use_model_manager'
import { clear_all_data, get_db } from '../../stores/db'
import { clear_browser_model_cache } from '../../utils/model_download'
import { export_conversation } from '../../utils/export'
import { storage_key, APP_PREFIX, EVENTS } from '../../utils/branding'
import { HF_TOKEN_SETTING } from '../../utils/hf_auth'
import use_llm from '../../stores/llm_store'

const Section = styled.div`
    margin-bottom: ${ ( { theme } ) => theme.spacing.lg };
`

const SectionTitle = styled.h3`
    font-size: 0.95rem;
    font-weight: 600;
    margin-bottom: ${ ( { theme } ) => theme.spacing.sm };
`

const Description = styled.p`
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    margin-bottom: ${ ( { theme } ) => theme.spacing.sm };
    line-height: 1.4;
`

const StorageSummary = styled.div`
    display: flex;
    gap: ${ ( { theme } ) => theme.spacing.md };
    padding: ${ ( { theme } ) => theme.spacing.sm };
    background: ${ ( { theme } ) => theme.colors.code_background };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    font-size: 0.8rem;
    margin-bottom: ${ ( { theme } ) => theme.spacing.md };
`

const StorageStat = styled.div`
    color: ${ ( { theme } ) => theme.colors.text_secondary };
`

const ModelList = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${ ( { theme } ) => theme.spacing.xs };
`

const ModelItem = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: ${ ( { theme } ) => theme.spacing.sm };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
`

const ModelInfo = styled.div`
    flex: 1;
    min-width: 0;
`

const ModelName = styled.div`
    font-weight: 500;
    font-size: 0.9rem;
`

const ModelMeta = styled.div`
    font-size: 0.75rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

const Badge = styled.span`
    font-size: 0.7rem;
    padding: 2px 6px;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    margin-left: ${ ( { theme } ) => theme.spacing.xs };
    background: ${ ( { theme } ) => theme.colors.code_background };
    color: ${ ( { theme, $variant } ) =>
        $variant === `active` ? theme.colors.text : theme.colors.text_secondary };
    font-weight: ${ ( { $variant } ) => $variant === `active` ? `600` : `400` };
`

const ModelActions = styled.div`
    display: flex;
    gap: ${ ( { theme } ) => theme.spacing.xs };
`

const SmallButton = styled.button`
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } ${ theme.spacing.sm }` };
    border-radius: ${ ( { theme } ) => theme.border_radius.sm };
    font-size: 0.75rem;
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    transition: all 0.15s;
    min-height: 2rem;

    &:hover:not(:disabled) {
        background: ${ ( { theme } ) => theme.colors.surface_hover };
    }

    &:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
`

const DeleteButton = styled( SmallButton )`
    border-color: ${ ( { theme } ) => theme.colors.error };
    color: ${ ( { theme } ) => theme.colors.error };

    &:hover:not(:disabled) {
        background: ${ ( { theme } ) => theme.colors.error };
        color: ${ ( { theme } ) => theme.colors.accent_ink };
    }
`

const EmptyState = styled.div`
    text-align: center;
    padding: ${ ( { theme } ) => theme.spacing.lg };
    color: ${ ( { theme } ) => theme.colors.text_muted };
    font-size: 0.85rem;
`

const ButtonRow = styled.div`
    display: flex;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    flex-wrap: wrap;
`

const Button = styled.button`
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } ${ theme.spacing.md }` };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    font-size: 0.85rem;
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    color: ${ ( { theme } ) => theme.colors.text };
    transition: all 0.15s;
    min-height: 2.75rem;

    &:hover {
        background: ${ ( { theme } ) => theme.colors.surface_hover };
    }
`

const TokenRow = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
`

const TokenInput = styled.input`
    flex: 1;
    min-width: 0;
    min-height: 2.75rem;
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } ${ theme.spacing.sm }` };
    background: ${ ( { theme } ) => theme.colors.input_background };
    border: 1px solid ${ ( { theme } ) => theme.colors.border_control };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    color: ${ ( { theme } ) => theme.colors.text };
    font-family: ${ ( { theme } ) => theme.fonts.mono };
    font-size: 0.8rem;

    &::placeholder {
        color: ${ ( { theme } ) => theme.colors.text_muted };
    }
`

const IconButton = styled.button`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    flex: 0 0 2.75rem;
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    transition: all 0.15s;

    &:hover {
        background: ${ ( { theme } ) => theme.colors.surface_hover };
        color: ${ ( { theme } ) => theme.colors.text };
    }
`

const TokenStatus = styled.div`
    margin-top: ${ ( { theme } ) => theme.spacing.xs };
    font-size: 0.75rem;
    color: ${ ( { theme, $active } ) => $active ? theme.colors.success : theme.colors.text_muted };
`

// Danger Zone — hidden behind a toggle for safety
const DangerToggle = styled.button`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    margin-top: ${ ( { theme } ) => theme.spacing.xl };
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    transition: color 0.15s;
    min-height: 2.75rem;

    &:hover { color: ${ ( { theme } ) => theme.colors.error }; }
`

const DangerPanel = styled.div`
    overflow: hidden;
    max-height: ${ ( { $expanded } ) => $expanded ? `400px` : `0px` };
    opacity: ${ ( { $expanded } ) => $expanded ? 1 : 0 };
    visibility: ${ ( { $expanded } ) => $expanded ? `visible` : `hidden` };
    transition: max-height 0.3s ease, opacity 0.2s ease, visibility 0.3s ease;

    @media ( prefers-reduced-motion: reduce ) {
        transition: none;
    }
`

const DangerZone = styled.div`
    border-top: 1px solid ${ ( { theme } ) => theme.colors.error };
    padding-top: ${ ( { theme } ) => theme.spacing.md };
    margin-top: ${ ( { theme } ) => theme.spacing.sm };
`

const DangerItem = styled.div`
    & + & { margin-top: ${ ( { theme } ) => theme.spacing.md }; }
`

const DangerButton = styled( Button )`
    border-color: ${ ( { theme } ) => theme.colors.error };
    color: ${ ( { theme } ) => theme.colors.error };

    &:hover:not( :disabled ) {
        background: ${ ( { theme } ) => theme.colors.error };
        color: ${ ( { theme } ) => theme.colors.accent_ink };
    }

    &:disabled {
        opacity: 0.5;
        cursor: progress;
    }
`

/**
 * Models settings tab with cached model management and danger zone.
 * Danger zone is hidden behind a toggle for safety (progressive disclosure).
 * @param {Object} props
 * @param {Object} props.settings - Current settings values
 * @param {Function} props.on_setting_change - Handler for updating settings
 * @param {Function} props.on_close - Handler to close settings modal
 * @param {Function} props.on_model_switch - Handler for switching models
 * @param {Function} [props.on_models_purged] - Called after all models were removed
 * @returns {JSX.Element}
 */
export default function ModelsSettings( { settings = {}, on_setting_change, on_close, on_model_switch, on_models_purged } ) {

    const navigate = useNavigate()
    const { t } = useTranslation( `settings` )
    const { cached_models, storage_used, storage_estimate, delete_model } = use_model_manager()
    const unload_model = use_llm( state => state.unload_model )
    const [ confirming, set_confirming ] = useState( null )
    const [ show_danger, set_show_danger ] = useState( false )
    const [ show_hf_token, set_show_hf_token ] = useState( false )
    const [ is_purging, set_is_purging ] = useState( false )
    const id = useId()
    const active_model_id = localStorage.getItem( storage_key( `active_model_id` ) )
    const hf_token = settings[ HF_TOKEN_SETTING ] || ``

    const handle_add_preset = () => {
        if( on_close ) on_close()
        navigate( `/select-model` )
    }

    const handle_add_custom = () => {
        if( on_close ) on_close()
        navigate( `/select-model?mode=custom` )
    }

    const handle_delete = async ( model ) => {

        if( confirming !== model.id ) {
            set_confirming( model.id )
            setTimeout( () => set_confirming( null ), 5000 )
            return
        }

        try {
            await delete_model( model.id )
            set_confirming( null )
            toast.success( t( `common:deleted_model`, { name: model.name } ) )
        } catch ( err ) {
            toast.error( err.message )
        }

    }

    const handle_load = ( model_id ) => {
        if( on_model_switch ) on_model_switch( model_id )
        if( on_close ) on_close()
    }

    const handle_hf_token_change = ( e ) => {
        on_setting_change?.( HF_TOKEN_SETTING, e.target.value.trim() )
    }

    const handle_export_all = async () => {

        try {
            const db = await get_db()
            const conversations = await db.getAll( `conversations` )
            if( conversations.length === 0 ) {
                toast( t( `common:no_conversations_to_export` ) )
                return
            }
            for( const conv of conversations ) {
                const messages = await db.getAllFromIndex( `messages`, `conversation_id`, conv.id )
                export_conversation( conv, messages )
            }
            toast.success( t( conversations.length !== 1 ? `common:exported_conversations_plural` : `common:exported_conversations`, { count: conversations.length } ) )
        } catch ( err ) {
            toast.error( t( `common:export_failed`, { message: err.message } ) )
        }

    }

    /**
     * Remove every downloaded model; conversations and settings stay.
     */
    const handle_purge = async () => {

        if( !confirm( t( `models:purge_confirm` ) ) ) return

        set_is_purging( true )

        try {

            // Release inference first so no worker holds model files open
            await unload_model()

            if( window.electronAPI?.native_inference ) {

                // Electron: delete each model via IPC
                const all = await window.electronAPI.list_models()
                for( const m of all ) {
                    try {
                        await window.electronAPI.delete_model( m.id )
                    } catch ( err ) {
                        log.warn( `[purge] Failed to delete local model ${ m.id }: ${ err.message }` )
                    }
                }

            } else {

                // Browser weights live in OPFS; IndexedDB contains metadata.
                // Clear both or multi-GB orphan files remain invisible on disk.
                await clear_browser_model_cache()
                const db = await get_db()
                await db.clear( `models` )

            }

            localStorage.removeItem( storage_key( `active_model_id` ) )
            log.info( `[purge] All models purged` )
            toast.success( t( `models:purge_success` ) )

            // Every page's model list refreshes, not only this modal's
            window.dispatchEvent( new Event( EVENTS.models_changed ) )
            on_models_purged?.()

        } catch ( err ) {
            log.error( `[purge] Error:`, err.message )
            toast.error( t( `models:purge_error`, { error: err.message } ) )
        } finally {
            set_is_purging( false )
        }

    }

    const handle_clear_all = async () => {

        const confirmed = confirm( t( `confirm_delete_all` ) )
        if( !confirmed ) return

        // OPFS cannot reliably remove a Blob while the WASM worker still holds
        // it open. Release inference before deleting browser model files.
        await unload_model()
        await clear_browser_model_cache()
        await clear_all_data()

        // Clear all app-owned localStorage keys
        const keys_to_remove = []
        for( let i = 0; i < localStorage.length; i++ ) {
            const key = localStorage.key( i )
            if( key?.startsWith( APP_PREFIX ) ) keys_to_remove.push( key )
        }
        keys_to_remove.forEach( ( k ) => localStorage.removeItem( k ) )

        if( on_close ) on_close()
        navigate( `/` )

    }

    return <>

        { /* Storage summary */ }
        <StorageSummary data-testid="storage-summary">
            <StorageStat>
                <strong>{ cached_models.length }</strong> { cached_models.length !== 1 ? t( `models_cached` ) : t( `model_cached` ) }
            </StorageStat>
            <StorageStat>
                <strong>{ format_file_size( storage_used ) }</strong> { t( `used` ) }
            </StorageStat>
            { storage_estimate !== null &&
                <StorageStat>
                    <strong>{ format_file_size( storage_estimate ) }</strong> { t( `available` ) }
                </StorageStat> }
        </StorageSummary>

        { /* Cached models list */ }
        <Section>
            <SectionTitle>{ t( `your_models` ) }</SectionTitle>
            <Description>{ t( `your_models_description` ) }</Description>
            { cached_models.length === 0 ?
                <EmptyState>{ t( `no_models_downloaded` ) }</EmptyState>
                :
                <ModelList>
                    { cached_models.map( ( model ) => {
                        const is_active = model.id === active_model_id
                        return <ModelItem key={ model.id } data-testid={ `cached-model-${ model.id }` }>
                            <ModelInfo>
                                <ModelName>
                                    { model.name }
                                    { is_active && <Badge $variant="active">{ t( `active` ) }</Badge> }
                                    { !is_active && <Badge>{ t( `cached` ) }</Badge> }
                                </ModelName>
                                <ModelMeta>
                                    { format_file_size( model.file_size_bytes ) }
                                </ModelMeta>
                            </ModelInfo>
                            <ModelActions>
                                <SmallButton
                                    data-testid={ `model-load-btn-${ model.id }` }
                                    disabled={ is_active }
                                    onClick={ () => handle_load( model.id ) }
                                >
                                    { is_active ? t( `active` ) : t( `switch_to_this` ) }
                                </SmallButton>
                                <DeleteButton
                                    data-testid={ `model-delete-btn-${ model.id }` }
                                    onClick={ () => handle_delete( model ) }
                                >
                                    { confirming === model.id ? t( `click_again_to_confirm` ) : t( `remove` ) }
                                </DeleteButton>
                            </ModelActions>
                        </ModelItem>
                    } ) }
                </ModelList> }
        </Section>

        { /* Hugging Face access */ }
        <Section>
            <SectionTitle id={ `${ id }-hf-title` }>{ t( `huggingface_access` ) }</SectionTitle>
            <Description id={ `${ id }-hf-description` }>{ t( `huggingface_access_description` ) }</Description>
            <TokenRow>
                <TokenInput
                    data-testid="hf-token-input"
                    aria-labelledby={ `${ id }-hf-title` }
                    aria-describedby={ `${ id }-hf-description` }
                    type={ show_hf_token ? `text` : `password` }
                    value={ hf_token }
                    placeholder="hf_..."
                    autoComplete="off"
                    spellCheck={ false }
                    onChange={ handle_hf_token_change }
                />
                <IconButton
                    type="button"
                    data-testid="hf-token-visibility-btn"
                    aria-label={ show_hf_token ? t( `hide_hf_token` ) : t( `show_hf_token` ) }
                    title={ show_hf_token ? t( `hide_hf_token` ) : t( `show_hf_token` ) }
                    onClick={ () => set_show_hf_token( ( value ) => !value ) }
                >
                    { show_hf_token ? <EyeOff size={ 16 } /> : <Eye size={ 16 } /> }
                </IconButton>
                { hf_token && <SmallButton
                    type="button"
                    data-testid="hf-token-clear-btn"
                    onClick={ () => on_setting_change?.( HF_TOKEN_SETTING, `` ) }
                >
                    { t( `clear_hf_token` ) }
                </SmallButton> }
            </TokenRow>
            <TokenStatus $active={ Boolean( hf_token ) }>
                { hf_token ? t( `hf_token_saved` ) : t( `hf_token_empty` ) }
            </TokenStatus>
        </Section>

        { /* Add model section */ }
        <Section>
            <SectionTitle>{ t( `add_model` ) }</SectionTitle>
            <Description>{ t( `add_model_description` ) }</Description>
            <ButtonRow>
                <Button
                    data-testid="add-model-preset-btn"
                    onClick={ handle_add_preset }
                >
                    { t( `browse_models` ) }
                </Button>
                <Button
                    data-testid="add-model-custom-btn"
                    onClick={ handle_add_custom }
                >
                    { t( `load_custom_file` ) }
                </Button>
            </ButtonRow>
        </Section>

        { /* Export all conversations */ }
        <Section>
            <SectionTitle>{ t( `your_data` ) }</SectionTitle>
            <Description>{ t( `your_data_description` ) }</Description>
            <ButtonRow>
                <Button
                    data-testid="export-all-btn"
                    onClick={ handle_export_all }
                >
                    { t( `export_all_conversations` ) }
                </Button>
            </ButtonRow>
        </Section>

        { /* Danger Zone — hidden behind toggle for safety */ }
        <DangerToggle
            data-testid="danger-zone-toggle"
            aria-expanded={ show_danger }
            aria-controls={ `${ id }-danger` }
            onClick={ () => set_show_danger( !show_danger ) }
        >
            { t( `danger_zone` ) }
            { show_danger ? <ChevronUp size={ 14 } /> : <ChevronDown size={ 14 } /> }
        </DangerToggle>

        <DangerPanel id={ `${ id }-danger` } $expanded={ show_danger }>
            <DangerZone>

                { cached_models.length > 0 && <DangerItem>
                    <Description>{ t( `purge_models_description` ) }</Description>
                    <ButtonRow>
                        <DangerButton
                            data-testid="purge-models-btn"
                            onClick={ handle_purge }
                            disabled={ is_purging }
                        >
                            { t( `models:purge_models` ) }
                        </DangerButton>
                    </ButtonRow>
                </DangerItem> }

                <DangerItem>
                    <Description>{ t( `danger_zone_description` ) }</Description>
                    <ButtonRow>
                        <DangerButton
                            data-testid="clear-all-data-btn"
                            onClick={ handle_clear_all }
                        >
                            { t( `delete_everything` ) }
                        </DangerButton>
                    </ButtonRow>
                </DangerItem>

            </DangerZone>
        </DangerPanel>

    </>

}
