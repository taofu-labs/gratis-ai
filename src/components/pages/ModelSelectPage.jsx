import { useState, useMemo, useEffect, useRef } from 'react'
import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ChevronUp, ArrowRight, Sparkles, AlertTriangle, LoaderCircle, Link, Zap, ShieldOff, Eye } from 'lucide-react'
import use_device_capabilities from '../../hooks/use_device_capabilities'
import use_model_manager from '../../hooks/use_model_manager'
import use_speed_estimate from '../../hooks/use_speed_estimate'
import { MODEL_CATALOG, select_model_options, format_file_size, can_fit_in_memory, estimate_download_time, estimate_model_memory, quality_score } from '../../utils/model_catalog'
import { parse_hf_url, resolve_hf_models } from '../../utils/hf_url_parser'
import { storage_key } from '../../utils/branding'

const Container = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    min-height: 0;
    padding: ${ ( { theme } ) => theme.spacing.xl };
    overflow-y: auto;
    background: ${ ( { theme } ) => theme.colors.background };

    /* Flex spacers center content when it fits, collapse when it overflows */
    &::before, &::after {
        content: '';
        flex: 1 0 0px;
    }
`

const Title = styled.h1`
    position: relative;
    font-size: clamp( 2rem, 4vw, 2.875rem );
    color: ${ ( { theme } ) => theme.colors.text };
    margin-bottom: ${ ( { theme } ) => theme.spacing.lg };
    padding-bottom: ${ ( { theme } ) => theme.spacing.md };

    &::after {
        content: '';
        position: absolute;
        left: 50%;
        bottom: 0;
        width: 5.5rem;
        height: 3px;
        border-radius: ${ ( { theme } ) => theme.border_radius.full };
        background: ${ ( { theme } ) => theme.colors.accent };
        transform: translateX( -50% );
    }
`

const Subtitle = styled.p`
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    margin-bottom: ${ ( { theme } ) => theme.spacing.xl };
    text-align: center;
    max-width: 520px;
    line-height: 1.6;
`


// ─── Two-card recommendation layout ─────────────────────────────────────────────

const CardRow = styled.div`
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: ${ ( { theme } ) => theme.spacing.md };
    width: 100%;
    max-width: 960px;
    margin-bottom: ${ ( { theme } ) => theme.spacing.md };

    /* Cards don't stretch — stays centered when count is uneven */
    & > * {
        flex: 0 0 calc( 25% - 0.75rem );
        min-width: 160px;
    }

    @media ( max-width: 680px ) {
        & > * { flex: 1 1 100%; min-width: 0; }
    }
`

// Resolve the accent color for a card variant
const variant_color = ( theme, $variant ) =>
    $variant === `uncensored` ? theme.colors.error
        : $variant === `vision` ? theme.colors.info
            : theme.colors.accent

const OptionCard = styled.button`
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: ${ ( { theme } ) => theme.spacing.lg };
    border: 1px solid ${ ( { theme, $active, $variant } ) =>
        $active ? variant_color( theme, $variant ) : theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.lg };
    text-align: center;
    transition: border-color 0.15s, background 0.15s, box-shadow 0.15s, transform 0.15s;
    cursor: pointer;
    background: ${ ( { theme } ) => theme.colors.surface };

    &:hover {
        border-color: ${ ( { theme, $active, $variant } ) =>
        $active ? variant_color( theme, $variant ) : theme.colors.text_muted };
        background: ${ ( { theme } ) => theme.colors.surface_hover };
        transform: translateY( -2px );
    }

    ${ ( { $active, $variant, theme } ) => $active && `
        box-shadow: 0 0 0 3px rgba( 255, 90, 31, 0.12 );
    ` }
`

const CardLabel = styled.h2`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: ${ ( { theme } ) => theme.spacing.sm };
    color: ${ ( { $variant, theme } ) =>
        $variant === `faster` ? theme.colors.success
            : $variant === `uncensored` ? theme.colors.error
                : $variant === `vision` ? theme.colors.info
                    : theme.colors.accent };
`

const DownloadEstimate = styled.p`
    font-size: 0.85rem;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    margin-bottom: ${ ( { theme } ) => theme.spacing.xs };
`

const CachedBadge = styled.div`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    color: ${ ( { theme } ) => theme.colors.success };
    margin-bottom: ${ ( { theme } ) => theme.spacing.xs };
`

const UncensoredTag = styled.span`
    font-size: 0.65rem;
    font-weight: 600;
    color: ${ ( { theme } ) => theme.colors.error };
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-left: 6px;
    flex-shrink: 0;
`

const VisionTag = styled.span`
    font-size: 0.65rem;
    font-weight: 600;
    color: ${ ( { theme } ) => theme.colors.info };
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-left: 6px;
    flex-shrink: 0;
`

const QualityBadge = styled.span`
    font-size: 0.75rem;
    font-weight: 600;
    color: ${ ( { theme } ) => theme.colors.accent };
`

const BenchmarkGrid = styled.div`
    display: flex;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    flex-wrap: wrap;
    margin-top: ${ ( { theme } ) => theme.spacing.xs };
    font-size: 0.7rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

const BenchmarkLabel = styled.span`
    text-transform: uppercase;
    opacity: 0.7;
    margin-right: 2px;
`

const CardDetailsToggle = styled.button`
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.75rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    margin-top: ${ ( { theme } ) => theme.spacing.xs };
    transition: color 0.15s;

    &:hover { color: ${ ( { theme } ) => theme.colors.text_secondary }; }
`

const CardDetails = styled.div`
    overflow: hidden;
    max-height: ${ ( { $open } ) => $open ? `120px` : `0px` };
    opacity: ${ ( { $open } ) => $open ? 1 : 0 };
    transition: max-height 0.2s ease, opacity 0.15s ease;
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    margin-top: ${ ( { $open, theme } ) => $open ? theme.spacing.xs : `0` };

    @media ( prefers-reduced-motion: reduce ) {
        transition: none;
    }
`


// ─── Single-card fallback (when no faster option exists) ─────────────────────────

const RecommendedCard = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: ${ ( { theme } ) => theme.spacing.lg };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.lg };
    max-width: 420px;
    width: 100%;
    margin-bottom: ${ ( { theme } ) => theme.spacing.md };
`

const RecommendedBadge = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.accent };
    font-weight: 600;
    margin-bottom: ${ ( { theme } ) => theme.spacing.sm };
`

// ─── Shared UI components ────────────────────────────────────────────────────────

const DownloadButton = styled.button`
    background: ${ ( { theme } ) => theme.colors.accent };
    color: ${ ( { theme } ) => theme.colors.accent_ink };
    padding: ${ ( { theme } ) => `${ theme.spacing.md } ${ theme.spacing.xl }` };
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    font-size: 1rem;
    font-weight: 600;
    margin-top: ${ ( { theme } ) => theme.spacing.md };
    transition: background 0.15s;
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    min-height: 2.75rem;

    &:hover { background: ${ ( { theme } ) => theme.colors.accent_hover }; }
`

// Toggle buttons for expanding model lists
const ToggleButton = styled.button`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    margin-top: ${ ( { theme } ) => theme.spacing.lg };
    font-size: 0.85rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    transition: color 0.15s;
    min-height: 2.75rem;

    &:hover { color: ${ ( { theme } ) => theme.colors.text_secondary }; }
`

const ExpandPanel = styled.div`
    overflow: hidden;
    max-height: ${ ( { $expanded } ) => $expanded ? `2000px` : `0px` };
    opacity: ${ ( { $expanded } ) => $expanded ? 1 : 0 };
    visibility: ${ ( { $expanded } ) => $expanded ? `visible` : `hidden` };
    transition: max-height 0.3s ease, opacity 0.2s ease, visibility 0.3s ease;
    flex-shrink: 0;
    width: 100%;
    max-width: 420px;

    @media ( prefers-reduced-motion: reduce ) {
        transition: none;
    }
`

const ModelList = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    padding-top: ${ ( { theme } ) => theme.spacing.md };
`

const ModelOption = styled.button`
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: ${ ( { theme } ) => theme.spacing.md };
    border: 1px solid ${ ( { theme, $active } ) => $active ? theme.colors.accent : theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    background: ${ ( { theme, $active } ) => $active ? `rgba( 255, 90, 31, 0.1 )` : theme.colors.surface };
    text-align: left;
    transition: border-color 0.15s, background 0.15s;

    &:hover {
        border-color: ${ ( { theme } ) => theme.colors.text_muted };
        background: ${ ( { theme } ) => theme.colors.surface_hover };
    }
`

const OptionInfo = styled.div`
    flex: 1;
`

const OptionName = styled.div`
    font-weight: 500;
    font-size: 0.9rem;
    margin-bottom: 2px;
`

const OptionMeta = styled.div`
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

const CheckIcon = styled.div`
    color: ${ ( { theme } ) => theme.colors.accent };
    flex-shrink: 0;
`

// Step progress indicator
const StepIndicator = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    margin-top: ${ ( { theme } ) => theme.spacing.lg };
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

const StepDot = styled.div`
    width: 8px;
    height: 8px;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    background: ${ ( { theme, $active, $done } ) =>
        $done ? theme.colors.accent
            : $active ? theme.colors.accent
                : theme.colors.border };
`

const StepLine = styled.div`
    width: 24px;
    height: 2px;
    background: ${ ( { theme, $done } ) => $done ? theme.colors.accent : theme.colors.border };
`

const MemoryWarning = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.warning || `#c49660` };
    margin-top: ${ ( { theme } ) => theme.spacing.sm };
`

// Low free RAM warning banner (Electron only)
const LowMemoryWarning = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    padding: ${ ( { theme } ) => theme.spacing.md };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    background: ${ ( { theme } ) => theme.colors.warning ? `${ theme.colors.warning }18` : `#c4966018` };
    border: 1px solid ${ ( { theme } ) => theme.colors.warning || `#c49660` };
    color: ${ ( { theme } ) => theme.colors.text };
    font-size: 0.85rem;
    line-height: 1.45;
    text-align: center;
    width: 100%;
    max-width: 680px;
    margin-bottom: ${ ( { theme } ) => theme.spacing.xl };

    svg { flex-shrink: 0; color: ${ ( { theme } ) => theme.colors.warning || `#c49660` }; }
`

// Custom model input section
const CustomModelSection = styled.div`
    margin-top: ${ ( { theme } ) => theme.spacing.md };
    padding-top: ${ ( { theme } ) => theme.spacing.md };
    border-top: 1px solid ${ ( { theme } ) => theme.colors.border };
    width: 100%;
`

const CustomModelLabel = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    font-size: 0.85rem;
    font-weight: 500;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    margin-bottom: ${ ( { theme } ) => theme.spacing.sm };
`

const CustomModelRow = styled.form`
    display: flex;
    gap: ${ ( { theme } ) => theme.spacing.xs };
`

const CustomModelInput = styled.input`
    flex: 1;
    padding: ${ ( { theme } ) => theme.spacing.sm };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    font-size: 0.85rem;
    background: ${ ( { theme } ) => theme.colors.input_background };
    color: ${ ( { theme } ) => theme.colors.text };
    min-width: 0;

    &::placeholder { color: ${ ( { theme } ) => theme.colors.text_muted }; }
    &:focus { outline: none; border-color: ${ ( { theme } ) => theme.colors.accent }; }
`

const LoadButton = styled.button`
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.md }` };
    border: 1px solid ${ ( { theme } ) => theme.colors.accent };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    color: ${ ( { theme } ) => theme.colors.accent };
    font-size: 0.85rem;
    font-weight: 500;
    white-space: nowrap;
    transition: all 0.15s;

    &:hover:not(:disabled) { background: ${ ( { theme } ) => theme.colors.accent }; color: white; }
    &:disabled { opacity: 0.5; cursor: not-allowed; }
`

const CustomModelStatus = styled.div`
    font-size: 0.8rem;
    margin-top: ${ ( { theme } ) => theme.spacing.xs };
    color: ${ ( { $error, theme } ) => $error ?  theme.colors.error || `#b85c5c`  : theme.colors.text_muted };
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    line-height: 1.35;
`

const CustomModelControls = styled.div`
    display: grid;
    grid-template-columns: minmax( 0, 1fr ) 8.5rem;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    margin-top: ${ ( { theme } ) => theme.spacing.sm };

    @media ( max-width: 520px ) {
        grid-template-columns: 1fr;
    }
`

const CustomModelField = styled.label`
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
`

const CustomModelFieldLabel = styled.span`
    font-size: 0.7rem;
    font-weight: 600;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    text-transform: uppercase;
`

const CustomModelSelect = styled.select`
    width: 100%;
    min-height: 2.5rem;
    padding: ${ ( { theme } ) => theme.spacing.sm };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    background: ${ ( { theme } ) => theme.colors.input_background };
    color: ${ ( { theme } ) => theme.colors.text };
    font-size: 0.85rem;

    &:focus {
        outline: none;
        border-color: ${ ( { theme } ) => theme.colors.accent };
    }
`

const CustomModelHint = styled.div`
    font-size: 0.75rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    margin-top: ${ ( { theme } ) => theme.spacing.xs };
    line-height: 1.35;
`

const Spinner = styled( LoaderCircle )`
    animation: spin 1s linear infinite;
    @keyframes spin { to { transform: rotate( 360deg ); } }
`

// ─── Section headers ──────────────────────────────────────────────────────────

const SectionHeader = styled.div`
    text-align: center;
    margin-top: ${ ( { theme } ) => theme.spacing.xl };
    margin-bottom: ${ ( { theme } ) => theme.spacing.md };
    width: 100%;
    max-width: 720px;

    &:first-of-type { margin-top: 0; }
`

const SectionTitle = styled.h2`
    font-size: 1.25rem;
    font-weight: 700;
    color: ${ ( { theme } ) => theme.colors.text };
    margin-bottom: 2px;
`

const SectionSubtitle = styled.p`
    font-size: 0.9rem;
    line-height: 1.55;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    max-width: 34rem;
    margin: 0 auto;
`


// ─── Benchmark display ────────────────────────────────────────────────────────

const BENCHMARK_LABELS = { mmlu: `MMLU`, gpqa: `GPQA`, humaneval: `Code`, math: `Math`, gsm8k: `GSM8K` }
const DEFAULT_CUSTOM_CONTEXT = 4096
const CUSTOM_CONTEXT_OPTIONS = [ 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144 ]

function BenchmarkRow( { benchmarks } ) {
    return <BenchmarkGrid>
        { Object.entries( BENCHMARK_LABELS ).map( ( [ key, label ] ) =>
            benchmarks[ key ] != null &&
                <span key={ key }><BenchmarkLabel>{ label }</BenchmarkLabel>{ benchmarks[ key ] }/100</span>
        ) }
    </BenchmarkGrid>
}


/**
 * Model selection page — recommends up to two models (faster + smarter),
 * auto-detects cached models, estimates download time, and allows alternatives.
 * @returns {JSX.Element}
 */
export default function ModelSelectPage() {

    const navigate = useNavigate()
    const { t } = useTranslation( 'models' )
    const [ show_alternatives, set_show_alternatives ] = useState( false )
    const expand_panel_ref = useRef( null )

    // Auto-scroll the alternatives panel into view on mobile when expanded
    useEffect( () => {

        if( !show_alternatives || !expand_panel_ref.current ) return

        const timer = setTimeout( () => {
            const prefers_reduced = window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches
            expand_panel_ref.current?.scrollIntoView( {
                behavior: prefers_reduced ? 'instant' : 'smooth',
                block: 'nearest',
            } )
        }, 80 )

        return () => clearTimeout( timer )

    }, [ show_alternatives ] )

    // Device memory budget and cached model detection
    const { capabilities, max_model_bytes } = use_device_capabilities()
    const { cached_models } = use_model_manager()

    // Measure real download speed for accurate time estimates
    const { speed_bps, run_estimate } = use_speed_estimate()
    useEffect( () => {
        run_estimate()
    }, [ run_estimate ] )

    const is_cached = ( model_id ) =>
        cached_models.some( m => m.id === model_id )

    // Select smarter/faster/uncensored/vision options based on device memory
    const { smarter, faster, uncensored, vision } = useMemo(
        () => select_model_options( max_model_bytes ),
        [ max_model_bytes ],
    )

    // All catalog models for the alternatives list, sorted: fits-in-memory first → params desc
    const catalog_models = useMemo( () => {

        return [ ...MODEL_CATALOG ].sort( ( a, b ) => {

            const a_fits = can_fit_in_memory( a, max_model_bytes ) ? 1 : 0
            const b_fits = can_fit_in_memory( b, max_model_bytes ) ? 1 : 0
            if( a_fits !== b_fits ) return b_fits - a_fits

            return quality_score( b ) - quality_score( a ) || b.bpw - a.bpw

        } )

    }, [ max_model_bytes ] )

    // Track user selection — defaults to the smarter option
    const [ selected_model_id, set_selected_model_id ] = useState( null )

    // Per-card "show details" toggle
    const [ details_open, set_details_open ] = useState( {} )
    const toggle_details = ( id ) => set_details_open( prev => ( { ...prev, [ id ]: !prev[ id ] } ) )

    // Custom model state
    const [ custom_url, set_custom_url ] = useState( `` )
    const [ custom_model_options, set_custom_model_options ] = useState( [] )
    const [ selected_custom_file, set_selected_custom_file ] = useState( null )
    const [ custom_context_length, set_custom_context_length ] = useState( DEFAULT_CUSTOM_CONTEXT )
    const [ custom_loading, set_custom_loading ] = useState( false )
    const [ custom_error, set_custom_error ] = useState( null )

    const custom_model = useMemo( () => {

        const selected_model = custom_model_options.find( model => model.file_name === selected_custom_file )
            || custom_model_options[ 0 ]

        if( !selected_model ) return null

        return {
            ...selected_model,
            context_length: custom_context_length,
        }

    }, [ custom_context_length, custom_model_options, selected_custom_file ] )

    // Resolve the active model — custom > user pick > smarter default
    const active_model = custom_model
        ? custom_model
        : selected_model_id
            ? catalog_models.find( m => m.id === selected_model_id ) ?? smarter
            : smarter

    const active_is_cached = active_model && is_cached( active_model.id )

    // Warn Electron users when free RAM is dangerously low for the selected model
    const is_electron = capabilities?.runtime === 'electron'
    const free_bytes = capabilities?.memory?.free_bytes
    const model_needs = active_model ? estimate_model_memory( active_model ) : 0
    const low_memory = is_electron && free_bytes && model_needs > 0 && free_bytes < model_needs * 1.2
    const browser_large_custom_model = !is_electron && active_model?.is_custom && active_model.file_size_bytes > 2_000_000_000

    const handle_download = () => {

        if( !active_model ) return

        if( active_model.is_custom ) {
            localStorage.setItem(
                storage_key( `model_context_length:${ active_model.id }` ),
                String( active_model.context_length )
            )
        }

        // Cached models can skip the download page entirely
        if( active_is_cached ) {
            localStorage.setItem( storage_key( `active_model_id` ), active_model.id )
            navigate( `/chat` )
            return
        }

        navigate( `/download`, { state: { model: active_model } } )

    }

    const handle_select = ( model_id ) => {
        set_custom_model_options( [] )
        set_selected_custom_file( null )
        set_custom_error( null )
        set_selected_model_id( model_id )
    }

    // Resolve a custom HuggingFace URL into a model definition
    const handle_custom_load = async ( e ) => {

        e.preventDefault()

        const parsed = parse_hf_url( custom_url )
        if( !parsed ) {
            set_custom_error( t( 'invalid_hf_url' ) )
            return
        }

        set_custom_loading( true )
        set_custom_error( null )
        set_custom_model_options( [] )
        set_selected_custom_file( null )
        set_selected_model_id( null )

        try {
            const models = await resolve_hf_models( parsed )
            set_custom_model_options( models )
            set_selected_custom_file( models[ 0 ]?.file_name ?? null )
        } catch ( err ) {
            set_custom_error( err.message )
        } finally {
            set_custom_loading( false )
        }

    }

    // Alternatives exclude all models shown as recommendation cards
    const shown_ids = new Set( [ smarter?.id, faster?.id, uncensored?.id, vision?.id ].filter( Boolean ) )
    const alternative_models = catalog_models.filter( m =>
        !shown_ids.has( m.id ) && can_fit_in_memory( m, max_model_bytes )
    )

    // Card row when we have at least 2 options to compare
    const card_count = 1 + ( faster ? 1 : 0 ) + ( uncensored ? 1 : 0 ) + ( vision ? 1 : 0 )
    const show_card_row = card_count >= 2

    return <Container>

        <Title>{ t( 'pick_a_model' ) }</Title>

        { /* ── Local Models section ── */ }
        <SectionHeader>
            <SectionTitle>{ t( 'local_models_section' ) }</SectionTitle>
            <SectionSubtitle>{ t( 'local_models_subtitle' ) }</SectionSubtitle>
        </SectionHeader>

        <Subtitle>
            { card_count >= 4
                ? t( 'subtitle_four_cards' )
                : card_count >= 3
                    ? t( 'subtitle_three_cards' )
                    : show_card_row
                        ? t( 'subtitle_two_cards' )
                        : t( 'subtitle_single_card' ) }
        </Subtitle>

        { /* ── Low free RAM warning (Electron only) ── */ }
        { low_memory && <LowMemoryWarning>
            <AlertTriangle size={ 16 } />
            <span>{ t( 'low_memory_warning', {
                free: format_file_size( free_bytes ),
                needed: format_file_size( model_needs ),
            } ) }</span>
        </LowMemoryWarning> }

        { /* ── Multi-card layout ── */ }
        { show_card_row && <CardRow>

            { /* Faster option */ }
            { faster && <OptionCard
                $active={ active_model?.id === faster.id }
                $variant="faster"
                onClick={ () => handle_select( faster.id ) }
            >
                <CardLabel $variant="faster">
                    <Zap size={ 18 } />
                    { t( 'faster_option' ) }
                </CardLabel>
                { is_cached( faster.id )
                    ? <CachedBadge><Check size={ 12 } /> { t( 'already_downloaded' ) }</CachedBadge>
                    : <DownloadEstimate>{ t( 'initial_download_takes', { time: estimate_download_time( faster.file_size_bytes, speed_bps ) } ) }</DownloadEstimate> }
                <CardDetailsToggle onClick={ ( e ) => {
                    e.stopPropagation(); toggle_details( faster.id )
                } }
                >
                    { t( 'show_details' ) } { details_open[ faster.id ] ? <ChevronUp size={ 12 } /> : <ChevronDown size={ 12 } /> }
                </CardDetailsToggle>
                <CardDetails $open={ !!details_open[ faster.id ] }>
                    { faster.name } — { format_file_size( faster.file_size_bytes ) } — { faster.quantization }
                    { faster.benchmarks && <BenchmarkRow benchmarks={ faster.benchmarks } /> }
                </CardDetails>
            </OptionCard> }

            { /* Smarter option */ }
            <OptionCard
                $active={ active_model?.id === smarter.id }
                $variant="smarter"
                onClick={ () => handle_select( smarter.id ) }
            >
                <CardLabel $variant="smarter">
                    <Sparkles size={ 18 } />
                    { t( 'smarter_option' ) }
                </CardLabel>
                { is_cached( smarter.id )
                    ? <CachedBadge><Check size={ 12 } /> { t( 'already_downloaded' ) }</CachedBadge>
                    : <DownloadEstimate>{ t( 'initial_download_takes', { time: estimate_download_time( smarter.file_size_bytes, speed_bps ) } ) }</DownloadEstimate> }
                <CardDetailsToggle onClick={ ( e ) => {
                    e.stopPropagation(); toggle_details( smarter.id )
                } }
                >
                    { t( 'show_details' ) } { details_open[ smarter.id ] ? <ChevronUp size={ 12 } /> : <ChevronDown size={ 12 } /> }
                </CardDetailsToggle>
                <CardDetails $open={ !!details_open[ smarter.id ] }>
                    { smarter.name } — { format_file_size( smarter.file_size_bytes ) } — { smarter.quantization }
                    { smarter.benchmarks && <BenchmarkRow benchmarks={ smarter.benchmarks } /> }
                </CardDetails>
            </OptionCard>

            { /* Uncensored option */ }
            { uncensored && <OptionCard
                $active={ active_model?.id === uncensored.id }
                $variant="uncensored"
                onClick={ () => handle_select( uncensored.id ) }
            >
                <CardLabel $variant="uncensored">
                    <ShieldOff size={ 18 } />
                    { t( 'uncensored_option' ) }
                </CardLabel>
                { is_cached( uncensored.id )
                    ? <CachedBadge><Check size={ 12 } /> { t( 'already_downloaded' ) }</CachedBadge>
                    : <DownloadEstimate>{ t( 'initial_download_takes', { time: estimate_download_time( uncensored.file_size_bytes, speed_bps ) } ) }</DownloadEstimate> }
                <CardDetailsToggle onClick={ ( e ) => {
                    e.stopPropagation(); toggle_details( uncensored.id )
                } }
                >
                    { t( 'show_details' ) } { details_open[ uncensored.id ] ? <ChevronUp size={ 12 } /> : <ChevronDown size={ 12 } /> }
                </CardDetailsToggle>
                <CardDetails $open={ !!details_open[ uncensored.id ] }>
                    { uncensored.name } — { format_file_size( uncensored.file_size_bytes ) } — { uncensored.quantization }
                    { uncensored.benchmarks && <BenchmarkRow benchmarks={ uncensored.benchmarks } /> }
                </CardDetails>
            </OptionCard> }

            { /* Vision option */ }
            { vision && <OptionCard
                $active={ active_model?.id === vision.id }
                $variant="vision"
                onClick={ () => handle_select( vision.id ) }
            >
                <CardLabel $variant="vision">
                    <Eye size={ 18 } />
                    { t( 'vision_option' ) }
                </CardLabel>
                { is_cached( vision.id )
                    ? <CachedBadge><Check size={ 12 } /> { t( 'already_downloaded' ) }</CachedBadge>
                    : <DownloadEstimate>{ t( 'initial_download_takes', { time: estimate_download_time( vision.file_size_bytes, speed_bps ) } ) }</DownloadEstimate> }
                <CardDetailsToggle onClick={ ( e ) => {
                    e.stopPropagation(); toggle_details( vision.id )
                } }
                >
                    { t( 'show_details' ) } { details_open[ vision.id ] ? <ChevronUp size={ 12 } /> : <ChevronDown size={ 12 } /> }
                </CardDetailsToggle>
                <CardDetails $open={ !!details_open[ vision.id ] }>
                    { vision.name } — { format_file_size( vision.file_size_bytes ) } — { vision.quantization }
                    { vision.benchmarks && <BenchmarkRow benchmarks={ vision.benchmarks } /> }
                </CardDetails>
            </OptionCard> }

        </CardRow> }

        { /* ── Single-card fallback (no meaningfully smaller model available) ── */ }
        { !show_card_row && active_model && <RecommendedCard>
            <RecommendedBadge>
                <Sparkles size={ 14 } />
                { custom_model ? t( 'custom_hf_model' ) : t( 'recommended_for_device' ) }
            </RecommendedBadge>
            { is_cached( active_model.id )
                ? <CachedBadge><Check size={ 12 } /> { t( 'already_downloaded' ) }</CachedBadge>
                : <DownloadEstimate>{ t( 'initial_download_takes', { time: estimate_download_time( active_model.file_size_bytes, speed_bps ) } ) }</DownloadEstimate> }
            <CardDetailsToggle onClick={ () => toggle_details( active_model.id ) }>
                { t( 'show_details' ) } { details_open[ active_model.id ] ? <ChevronUp size={ 12 } /> : <ChevronDown size={ 12 } /> }
            </CardDetailsToggle>
            <CardDetails $open={ !!details_open[ active_model.id ] }>
                { active_model.name } — { format_file_size( active_model.file_size_bytes ) }
                { active_model.quantization && ` — ${ active_model.quantization }` }
                { active_model.benchmarks && <BenchmarkRow benchmarks={ active_model.benchmarks } /> }
            </CardDetails>
            { !can_fit_in_memory( active_model, max_model_bytes ) && <MemoryWarning>
                <AlertTriangle size={ 14 } />
                { t( 'may_be_too_large_browser' ) }
            </MemoryWarning> }
        </RecommendedCard> }

        { /* All alternatives in one list — within the local models section */ }
        { alternative_models.length > 0 && <>
            <ToggleButton
                data-testid="change-model-toggle"
                onClick={ () => set_show_alternatives( !show_alternatives ) }
            >
                { t( 'choose_different_model' ) }
                { show_alternatives ? <ChevronUp size={ 14 } /> : <ChevronDown size={ 14 } /> }
            </ToggleButton>

            <ExpandPanel ref={ expand_panel_ref } $expanded={ show_alternatives }>
                <ModelList>
                    { alternative_models.map( ( model ) => {
                        const is_selected = model.id === active_model?.id
                        return <ModelOption
                            key={ model.id }
                            $active={ is_selected }
                            onClick={ () => handle_select( model.id ) }
                        >
                            <OptionInfo>
                                <OptionName>
                                    { model.name }
                                    { model.uncensored && <UncensoredTag>{ t( 'uncensored' ) }</UncensoredTag> }
                                    { model.vision && <VisionTag>{ t( 'vision' ) }</VisionTag> }
                                </OptionName>
                                <OptionMeta>
                                    { model.parameters_label } — { format_file_size( model.file_size_bytes ) } — { model.quantization }
                                    { model.benchmarks && <> — <QualityBadge>Score { quality_score( model ).toFixed( 0 ) }/100</QualityBadge></> }
                                    { is_cached( model.id ) ? ` — ✓ ${ t( 'downloaded' ) }` : `` }
                                </OptionMeta>
                            </OptionInfo>
                            { is_selected && <CheckIcon><Check size={ 16 } /></CheckIcon> }
                        </ModelOption>
                    } ) }
                </ModelList>

                { /* Custom HuggingFace model input */ }
                <CustomModelSection>
                    <CustomModelLabel>
                        <Link size={ 14 } />
                        { t( 'custom_hf_model' ) }
                    </CustomModelLabel>

                    <CustomModelRow onSubmit={ handle_custom_load }>
                        <CustomModelInput
                            data-testid="custom-model-input"
                            type="text"
                            placeholder="hf.co/org/repo"
                            value={ custom_url }
                            onChange={ ( e ) => set_custom_url( e.target.value ) }
                            disabled={ custom_loading }
                        />
                        <LoadButton
                            data-testid="custom-model-load-btn"
                            type="submit"
                            disabled={ custom_loading || !custom_url.trim() }
                        >
                            { custom_loading ? t( 'common:loading' ) : t( 'common:load' ) }
                        </LoadButton>
                    </CustomModelRow>

                    { /* Status feedback */ }
                    { custom_loading && <CustomModelStatus>
                        <Spinner size={ 12 } /> { t( 'common:resolving' ) }
                    </CustomModelStatus> }

                    { custom_error && <CustomModelStatus $error>
                        <AlertTriangle size={ 12 } /> { custom_error }
                    </CustomModelStatus> }

                    { custom_model_options.length > 0 && !custom_loading && <CustomModelControls>
                        <CustomModelField>
                            <CustomModelFieldLabel>{ t( 'quantization_label' ) }</CustomModelFieldLabel>
                            <CustomModelSelect
                                data-testid="custom-model-quant-select"
                                value={ selected_custom_file || `` }
                                onChange={ ( e ) => set_selected_custom_file( e.target.value ) }
                            >
                                { custom_model_options.map( model =>
                                    <option key={ model.file_name } value={ model.file_name }>
                                        { model.quantization } - { format_file_size( model.file_size_bytes ) } - { model.file_name }
                                    </option>
                                ) }
                            </CustomModelSelect>
                        </CustomModelField>

                        <CustomModelField>
                            <CustomModelFieldLabel>{ t( 'context_length_label' ) }</CustomModelFieldLabel>
                            <CustomModelSelect
                                data-testid="custom-model-context-select"
                                value={ custom_context_length }
                                onChange={ ( e ) => set_custom_context_length( parseInt( e.target.value, 10 ) ) }
                            >
                                { CUSTOM_CONTEXT_OPTIONS.map( context_length =>
                                    <option key={ context_length } value={ context_length }>
                                        { context_length.toLocaleString() }
                                    </option>
                                ) }
                            </CustomModelSelect>
                        </CustomModelField>
                    </CustomModelControls> }

                    { custom_model && !custom_loading && <CustomModelStatus>
                        <Check size={ 12 } /> { custom_model.name } - { custom_model.quantization }, { custom_model.context_length.toLocaleString() } ctx
                    </CustomModelStatus> }

                    { custom_model && !custom_loading && !is_electron && custom_model.context_length > 2048 && <CustomModelHint>
                        { t( 'browser_context_cap' ) }
                    </CustomModelHint> }

                    { /* Warn browser users about large custom models that may exceed WASM limits */ }
                    { custom_model && !custom_loading && browser_large_custom_model && <CustomModelStatus $error>
                        <AlertTriangle size={ 12 } /> { t( 'large_model_warning' ) }
                    </CustomModelStatus> }

                </CustomModelSection>

            </ExpandPanel>
        </> }

        { /* ── Download action + step progress ── */ }
        <DownloadButton
            data-testid="model-select-confirm-btn"
            onClick={ handle_download }
        >
            { active_is_cached ? t( 'start_chatting' ) : t( 'download_and_start' ) } <ArrowRight size={ 18 } />
        </DownloadButton>

        <StepIndicator data-testid="step-indicator">
            <StepDot $done />
            <StepLine $done />
            <StepDot $active />
            <StepLine />
            <StepDot />
        </StepIndicator>

    </Container>

}
