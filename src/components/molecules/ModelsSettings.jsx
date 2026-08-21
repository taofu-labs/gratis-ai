import { useState } from 'react'
import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { format_file_size } from '../../utils/model_catalog'
import use_model_manager from '../../hooks/use_model_manager'
import { clear_all_data, get_db } from '../../stores/db'
import { clear_browser_model_cache } from '../../utils/model_download'
import { export_conversation } from '../../utils/export'
import { storage_key, APP_PREFIX } from '../../utils/branding'
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
        color: white;
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
    max-height: ${ ( { $expanded } ) => $expanded ? `200px` : `0px` };
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

const DangerButton = styled( Button )`
    border-color: ${ ( { theme } ) => theme.colors.error };
    color: ${ ( { theme } ) => theme.colors.error };

    &:hover {
        background: ${ ( { theme } ) => theme.colors.error };
        color: white;
    }
`

/**
 * Models settings tab with cached model management and danger zone.
 * Danger zone is hidden behind a toggle for safety (progressive disclosure).
 * @param {Object} props
 * @param {Function} props.on_close - Handler to close settings modal
 * @param {Function} props.on_model_switch - Handler for switching models
 * @returns {JSX.Element}
 */
export default function ModelsSettings( { on_close, on_model_switch } ) {

    const navigate = useNavigate()
    const { t } = useTranslation( `settings` )
    const { cached_models, storage_used, storage_estimate, delete_model } = use_model_manager()
    const unload_model = use_llm( state => state.unload_model )
    const [ confirming, set_confirming ] = useState( null )
    const [ show_danger, set_show_danger ] = useState( false )
    const active_model_id = localStorage.getItem( storage_key( `active_model_id` ) )

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
                                    disabled={ is_active }
                                    onClick={ () => handle_delete( model ) }
                                >
                                    { confirming === model.id ? t( `click_again_to_confirm` ) : t( `remove` ) }
                                </DeleteButton>
                            </ModelActions>
                        </ModelItem>
                    } ) }
                </ModelList> }
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
            onClick={ () => set_show_danger( !show_danger ) }
        >
            { t( `danger_zone` ) }
            { show_danger ? <ChevronUp size={ 14 } /> : <ChevronDown size={ 14 } /> }
        </DangerToggle>

        <DangerPanel $expanded={ show_danger }>
            <DangerZone>
                <Description>{ t( `danger_zone_description` ) }</Description>
                <ButtonRow>
                    <DangerButton
                        data-testid="clear-all-data-btn"
                        onClick={ handle_clear_all }
                    >
                        { t( `delete_everything` ) }
                    </DangerButton>
                </ButtonRow>
            </DangerZone>
        </DangerPanel>

    </>

}
