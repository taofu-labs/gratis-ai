import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { log } from 'mentie'
import { Check, ChevronDown, ChevronUp, ArrowLeft, ArrowRight, Sparkles, AlertTriangle, LoaderCircle, Link, Zap, ShieldOff, Eye, HardDrive, Settings } from 'lucide-react'
import use_device_capabilities from '../../hooks/use_device_capabilities'
import use_model_manager from '../../hooks/use_model_manager'
import use_speed_estimate from '../../hooks/use_speed_estimate'
import BrowserRamOverride from '../atoms/BrowserRamOverride'
import LanguageSelector from '../molecules/LanguageSelector'
import SettingsModal from '../molecules/SettingsModal'
import {
    BROWSER_AUTOMATIC_MODEL_CEILING_BYTES,
    read_browser_ram_override,
    supports_browser_ram_override,
} from '../../utils/device_detection'
import {
    format_file_size,
    can_fit_in_memory,
    estimate_model_memory,
    quality_score,
    benchmark_coverage,
    select_picker_models,
} from '../../utils/model_catalog'
import { build_download_url, parse_hf_url, resolve_hf_model } from '../../utils/hf_url_parser'
import { resolve_tpn_winner_models } from '../../utils/tpn_winner_models'
import {
    choose_external_model_file,
    should_use_external_model_file,
} from '../../utils/external_model_files'
import { EVENTS, storage_key } from '../../utils/branding'
import { format_download_duration, get_speed_estimate } from '../../utils/network_speed'

const Container = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    min-height: 0;
    padding: ${ ( { theme } ) => theme.spacing.xl };
    overflow-y: auto;

    /* Flex spacers center content when it fits, collapse when it overflows */
    &::before, &::after {
        content: '';
        flex: 1 0 0px;
    }
`

const PageActions = styled.div`
    position: fixed;
    top: ${ ( { theme } ) => theme.spacing.md };
    right: ${ ( { theme } ) => theme.spacing.md };
    z-index: 10;
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
`

const BackActions = styled.div`
    position: fixed;
    top: ${ ( { theme } ) => theme.spacing.md };
    left: ${ ( { theme } ) => theme.spacing.md };
    z-index: 10;
`

const BackButton = styled.button`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    min-height: 2.75rem;
    padding: 0 ${ ( { theme } ) => theme.spacing.sm };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    font-size: 0.85rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    transition: color 0.15s;

    &:hover { color: ${ ( { theme } ) => theme.colors.text }; }

    /* Icon-only on phones so the label never collides with the title */
    @media ( max-width: 480px ) {
        span { display: none; }
    }
`

const IconButton = styled.button`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    color: ${ ( { theme } ) => theme.colors.text_muted };
    transition: color 0.15s;

    &:hover {
        color: ${ ( { theme } ) => theme.colors.text };
    }
`

const Title = styled.h1`
    font-size: clamp( 1.5rem, 1.2rem + 1.5vw, 2rem );
    color: ${ ( { theme } ) => theme.colors.text };
    border-bottom: 3px solid ${ ( { theme } ) => theme.colors.accent };
    margin-bottom: 2rem;
`

const Subtitle = styled.p`
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    margin-bottom: ${ ( { theme } ) => theme.spacing.xl };
    text-align: center;
    max-width: 520px;
    line-height: 1.5;
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
            : $variant === `nerd` ? theme.colors.info
                : theme.colors.accent

const OptionCard = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: ${ ( { theme } ) => theme.spacing.lg };
    border: 2px solid ${ ( { theme, $active, $variant } ) =>
        $active ? variant_color( theme, $variant ) : theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.lg };
    text-align: center;
    transition: border-color 0.15s, box-shadow 0.15s;
    cursor: pointer;
    background: transparent;

    &:hover {
        border-color: ${ ( { theme, $active, $variant } ) =>
        $active ? variant_color( theme, $variant ) : theme.colors.text_muted };
    }

    ${ ( { $active, $variant, theme } ) => $active && `
        box-shadow: 0 0 0 1px ${ variant_color( theme, $variant ) };
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
                : $variant === `vision` || $variant === `nerd` ? theme.colors.info
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
    border: 1px solid ${ ( { theme, $active } ) => $active ? theme.colors.accent : theme.colors.border };
    cursor: ${ ( { role } ) => role === `button` ? `pointer` : `default` };
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

const RecommendedName = styled.div`
    font-size: 1rem;
    font-weight: 600;
    color: ${ ( { theme } ) => theme.colors.text };
    margin-bottom: ${ ( { theme } ) => theme.spacing.xs };
`

const RecommendedMeta = styled.div`
    font-size: 0.85rem;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    text-align: center;
    line-height: 1.45;
`

// ─── Shared UI components ────────────────────────────────────────────────────────

const DownloadButton = styled.button`
    background: ${ ( { theme } ) => theme.colors.accent };
    color: white;
    padding: ${ ( { theme } ) => `${ theme.spacing.md } ${ theme.spacing.xl }` };
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    font-size: 1rem;
    font-weight: 600;
    margin-top: ${ ( { theme } ) => theme.spacing.md };
    transition: opacity 0.15s;
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    min-height: 2.75rem;

    &:hover { opacity: 0.85; }

    &:disabled {
        cursor: not-allowed;
        opacity: 0.45;
    }
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
    width: 100%;
    max-width: 520px;
`

const ModelOption = styled.button`
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    width: 100%;
    padding: ${ ( { theme } ) => theme.spacing.md };
    border: 1px solid ${ ( { theme, $active } ) => $active ? theme.colors.accent : theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    text-align: left;
    background: ${ ( { theme, $active } ) => $active ? `${ theme.colors.accent }10` : `transparent` };
    transition: border-color 0.15s, background 0.15s;

    &:hover {
        border-color: ${ ( { theme } ) => theme.colors.text_muted };
    }
`

// Cached rows hold their own action button, so the row itself is not a button
const CachedRow = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    width: 100%;
    padding: ${ ( { theme } ) => theme.spacing.md };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    text-align: left;
`

const OptionInfo = styled.div`
    flex: 1;
    min-width: 0;
`

const OptionName = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    font-weight: 500;
    font-size: 0.9rem;
    margin-bottom: 2px;
`

const OptionMeta = styled.div`
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    line-height: 1.45;
    overflow-wrap: anywhere;
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
    justify-content: center;
    flex-wrap: wrap;
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
    max-width: 420px;
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

const InlineActionButton = styled.button`
    color: ${ ( { theme } ) => theme.colors.accent };
    font-size: 0.8rem;
    font-weight: 600;
    min-height: 1.5rem;

    &:hover { text-decoration: underline; }
`

const CustomModelStatus = styled.div`
    font-size: 0.8rem;
    margin-top: ${ ( { theme } ) => theme.spacing.xs };
    color: ${ ( { $error, theme } ) => $error ?  theme.colors.error || `#b85c5c`  : theme.colors.text_muted };
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
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
    font-size: 1.1rem;
    font-weight: 600;
    color: ${ ( { theme } ) => theme.colors.text };
    margin-bottom: 2px;
`

const SectionSubtitle = styled.p`
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

// ─── Benchmark display ────────────────────────────────────────────────────────

const BENCHMARK_LABELS = { mmlu: `MMLU`, gpqa: `GPQA`, humaneval: `Code`, math: `Math`, gsm8k: `GSM8K` }

function BenchmarkRow( { benchmarks } ) {
    return <BenchmarkGrid>
        { Object.entries( BENCHMARK_LABELS ).map( ( [ key, label ] ) =>
            benchmarks[ key ] != null &&
                <span key={ key }><BenchmarkLabel>{ label }</BenchmarkLabel>{ benchmarks[ key ] }/100</span>
        ) }
    </BenchmarkGrid>
}


// ─── Plain-language helpers ─────────────────────────────────────────────────────

// Bound TPN discovery so a stalled connection falls back instead of spinning forever
const TPN_DISCOVERY_TIMEOUT_MS = 10_000

const timed_fetch = ( url, options = {} ) =>
    fetch( url, { ...options, signal: AbortSignal.timeout( TPN_DISCOVERY_TIMEOUT_MS ) } )

const has_parameter_label = ( { parameters_label } ) => !!parameters_label && parameters_label !== `Custom`

// Rough speed/quality class: parameter count, or ~2 params per byte at Q4 when unknown
const speed_hint_key = ( { parameters, file_size_bytes = 0 } ) => {
    const size_class = parameters || file_size_bytes * 2
    if( size_class < 1_000_000_000 ) return `hint_tiny`
    if( size_class < 4_000_000_000 ) return `hint_small`
    if( size_class < 10_000_000_000 ) return `hint_medium`
    return `hint_large`
}

// Network failures surface as browser-specific TypeErrors ("Failed to fetch", "Load failed")
const is_network_error = error =>
    error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test( error?.message || `` )

const friendly_lookup_error = ( error, t ) => {
    if( navigator.onLine === false ) return t( 'custom_model_offline' )
    if( is_network_error( error ) ) return t( 'custom_model_network_error' )
    return error?.message || t( 'custom_model_network_error' )
}

const model_download_url = model => model?.hugging_face_repo && model?.file_name
    ? build_download_url( model.hugging_face_repo, model.file_name )
    : null

// Recommendation card variants, in display order
const CARD_VARIANTS = [
    { key: `faster`, icon: Zap, label: `faster_option` },
    { key: `smarter`, icon: Sparkles, label: `smarter_option` },
    { key: `uncensored`, icon: ShieldOff, label: `uncensored_option` },
    { key: `vision`, icon: Eye, label: `vision_option` },
]


/**
 * Model selection page — TPN winners first; when none fit or exist, the catalog's
 * device-fit recommendations. Lists cached models for instant reuse and accepts
 * custom Hugging Face GGUF links.
 * @returns {JSX.Element}
 */
export default function ModelSelectPage() {

    const navigate = useNavigate()
    const { t } = useTranslation( 'models' )
    const [ show_alternatives, set_show_alternatives ] = useState( false )
    const [ settings_open, set_settings_open ] = useState( false )
    const expand_panel_ref = useRef( null )

    useEffect( () => {

        const handle_open_settings = () => set_settings_open( true )
        window.addEventListener( EVENTS.open_settings, handle_open_settings )
        return () => window.removeEventListener( EVENTS.open_settings, handle_open_settings )

    }, [] )

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
    const { capabilities, max_model_bytes, is_detecting } = use_device_capabilities()
    const { cached_models } = use_model_manager()
    const [ tpn_models, set_tpn_models ] = useState( [] )
    const [ tpn_loading, set_tpn_loading ] = useState( true )
    const [ tpn_error, set_tpn_error ] = useState( null )

    // Returning users can go straight back to their current chat
    const active_model_id = localStorage.getItem( storage_key( `active_model_id` ) )

    const is_cached = ( model_id ) =>
        cached_models.some( m => m.id === model_id )

    const load_tpn_models = useCallback( async () => {

        set_tpn_loading( true )
        set_tpn_error( null )

        try {
            const models = await resolve_tpn_winner_models( { fetch_impl: timed_fetch } )
            set_tpn_models( models )
        } catch ( err ) {
            log.warn( `[models] TPN winner discovery failed, using catalog fallback:`, err )
            set_tpn_models( [] )
            set_tpn_error( err )
        } finally {
            set_tpn_loading( false )
        }

    }, [] )

    useEffect( () => {
        load_tpn_models()
    }, [ load_tpn_models ] )

    // Automatic browser picks stay conservative even when Chromium reports the
    // host's full RAM. Larger, receipt-backed models remain explicit choices.
    const is_browser = capabilities?.runtime === `browser`
    const automatic_model_budget = is_browser
        ? Math.min( max_model_bytes, BROWSER_AUTOMATIC_MODEL_CEILING_BYTES )
        : max_model_bytes

    // TPN winners lead; the catalog only fills in when no winner fits this device
    const { winners, use_catalog, recommendations, alternatives: alternative_models } = useMemo(
        () => select_picker_models( {
            winners: tpn_models,
            max_bytes: max_model_bytes,
            automatic_bytes: automatic_model_budget,
            receipt_ceiling_bytes: is_browser ? BROWSER_AUTOMATIC_MODEL_CEILING_BYTES : null,
        } ),
        [ tpn_models, max_model_bytes, automatic_model_budget, is_browser ],
    )

    // Hold the catalog back until discovery settles, so winners don't pop in over it
    const show_catalog = use_catalog && !tpn_loading && !is_detecting
    const { smarter } = recommendations
    const recommended_cards = show_catalog
        ? CARD_VARIANTS.filter( ( { key } ) => recommendations[ key ] )
        : []

    // Track user selection — winners need an explicit pick, the catalog defaults to smarter
    const [ selected_model_id, set_selected_model_id ] = useState( null )

    // Per-card "show details" toggle
    const [ details_open, set_details_open ] = useState( {} )
    const toggle_details = ( id ) => set_details_open( prev => ( { ...prev, [ id ]: !prev[ id ] } ) )

    // Custom model state
    const [ custom_url, set_custom_url ] = useState( `` )
    const [ custom_model, set_custom_model ] = useState( null )
    const [ custom_loading, set_custom_loading ] = useState( false )
    const [ custom_error, set_custom_error ] = useState( null )

    const selectable_models = [
        ...winners,
        ...show_catalog ? [ ...recommended_cards.map( ( { key } ) => recommendations[ key ] ), ...alternative_models ] : [],
    ]

    const selected_model = selected_model_id
        ? selectable_models.find( m => m.id === selected_model_id ) ?? null
        : null

    // Resolve the active model — custom > explicit pick > catalog default.
    // Cached models already offer one-click reuse, so they suppress the default download.
    const active_model = custom_model
        || selected_model
        || ( show_catalog && !cached_models.length ? smarter : null )

    // Same host-scoped estimator the download page records into; probe only the active pick
    const speed_target_url = model_download_url( active_model )
    const { speed_bps, is_estimating, run_estimate } = use_speed_estimate( speed_target_url )

    useEffect( () => {
        if( is_detecting || !speed_target_url ) return
        const timer = setTimeout( run_estimate, 250 )
        return () => clearTimeout( timer )
    }, [ is_detecting, run_estimate, speed_target_url ] )

    // Size always; time only from a real measurement, never a guessed range
    const download_estimate = model => {

        const size = format_file_size( model.file_size_bytes )
        const url = model_download_url( model )
        const bps = speed_bps ||  url && get_speed_estimate( url )?.bps 

        if( bps ) return t( 'download_size_with_time', {
            size,
            time: format_download_duration( model.file_size_bytes / bps, t ),
        } )
        if( is_estimating && model.id === active_model?.id ) return t( 'measuring_download_speed' )
        return t( 'download_size', { size } )

    }

    const active_is_cached = active_model && is_cached( active_model.id )

    // Warn Electron users when free RAM is dangerously low for the selected model
    const is_electron = capabilities?.runtime === 'electron'
    const free_bytes = capabilities?.memory?.free_bytes
    const model_needs = active_model ? estimate_model_memory( active_model ) : 0
    const low_memory = is_electron && free_bytes && model_needs > 0 && free_bytes < model_needs * 1.2
    const active_model_too_large = !!active_model && !can_fit_in_memory( active_model, max_model_bytes )
    const has_ram_override = supports_browser_ram_override() && !!read_browser_ram_override()

    const active_uses_external_file = active_model && should_use_external_model_file( active_model )

    // Cached models skip the download page entirely
    const use_cached_model = model_id => {
        localStorage.setItem( storage_key( `active_model_id` ), model_id )
        navigate( `/chat` )
    }

    const handle_download = async () => {

        if( !active_model ) return
        if( active_model_too_large ) {
            set_custom_error( t( 'model_does_not_fit' ) )
            return
        }

        if( active_is_cached ) return use_cached_model( active_model.id )

        try {
            const storage_mode = should_use_external_model_file( active_model )
                ? `external-file`
                : `opfs`

            if( storage_mode === `external-file` ) await choose_external_model_file( active_model )
            navigate( `/download`, { state: { model: active_model, storage_mode } } )
        } catch ( error ) {
            if( error?.name !== `AbortError` ) {
                set_custom_error( error.message || t( 'download_storage_failed' ) )
            }
        }

    }

    const handle_select = ( model_id ) => {
        set_custom_model( null )
        set_custom_error( null )
        set_selected_model_id( model_id )
    }

    const select_with_keyboard = ( event, model_id ) => {
        if( ![ `Enter`, ` ` ].includes( event.key ) ) return
        event.preventDefault()
        handle_select( model_id )
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
        set_custom_model( null )
        set_selected_model_id( null )

        try {
            const model = await resolve_hf_model( parsed )
            set_custom_model( model )
        } catch ( err ) {
            log.warn( `[models] Custom model lookup failed:`, err )
            set_custom_error( friendly_lookup_error( err, t ) )
        } finally {
            set_custom_loading( false )
        }

    }

    // Friendly one-liner: "360M parameters · 271 MB"
    const friendly_meta = model => [
        has_parameter_label( model ) && t( 'parameters_count', { params: model.parameters_label } ),
        format_file_size( model.file_size_bytes ),
    ].filter( Boolean ).join( ` · ` )

    const cached_badge_or_estimate = model => is_cached( model.id )
        ? <CachedBadge><Check size={ 12 } /> { t( 'already_downloaded' ) }</CachedBadge>
        : <DownloadEstimate>{ download_estimate( model ) }</DownloadEstimate>

    // Cards are clickable themselves, so the toggle must not also select
    const details_toggle = id => <CardDetailsToggle
        aria-expanded={ !!details_open[ id ] }
        onClick={ e => {
            e.stopPropagation()
            toggle_details( id )
        } }
        onKeyDown={ e => e.stopPropagation() }
    >
        { t( 'show_details' ) } { details_open[ id ] ? <ChevronUp size={ 12 } /> : <ChevronDown size={ 12 } /> }
    </CardDetailsToggle>

    // Plain-language card: name, size, speed hint; jargon stays behind "Show details"
    const summary_card = ( model, badge, card_props ) => <RecommendedCard
        data-testid={ `model-option-${ model.id }` }
        { ...card_props }
    >
        <RecommendedBadge>
            <Sparkles size={ 14 } />
            { badge }
        </RecommendedBadge>
        <RecommendedName>{ model.name }</RecommendedName>
        <RecommendedMeta>
            { [
                has_parameter_label( model ) && t( 'parameters_count', { params: model.parameters_label } ),
                t( speed_hint_key( model ) ),
            ].filter( Boolean ).join( ` · ` ) }
        </RecommendedMeta>
        { cached_badge_or_estimate( model ) }
        { details_toggle( model.id ) }
        <CardDetails $open={ !!details_open[ model.id ] }>
            { model.hugging_face_repo && <div>{ model.hugging_face_repo }</div> }
            { model.file_name && <div>{ model.file_name }</div> }
            <div>
                { model.quantization || t( 'unknown_quantization' ) }
                { model.context_length && ` — ${ t( 'context_window_label', { context: model.context_length.toLocaleString() } ) }` }
            </div>
            { model.benchmarks && <BenchmarkRow benchmarks={ model.benchmarks } /> }
        </CardDetails>
    </RecommendedCard>

    // Explain why the catalog is showing instead of TPN winners
    const catalog_reason = tpn_error ? t( 'tpn_fallback_unreachable' )
        : winners.length ? t( 'tpn_fallback_too_large' )
            : t( 'tpn_fallback_none_yet' )

    const card_count = recommended_cards.length
    const show_card_row = card_count >= 2

    return <Container>

        { active_model_id && <BackActions>
            <BackButton
                data-testid="back-to-chat-btn"
                aria-label={ t( 'back_to_chat' ) }
                onClick={ () => navigate( `/chat` ) }
            >
                <ArrowLeft size={ 16 } />
                <span>{ t( 'back_to_chat' ) }</span>
            </BackButton>
        </BackActions> }

        <PageActions>
            <LanguageSelector />
            <IconButton
                data-testid="settings-btn"
                onClick={ () => set_settings_open( true ) }
                aria-label={ t( `common:aria_open_settings` ) }
            >
                <Settings size={ 18 } />
            </IconButton>
        </PageActions>

        <Title>{ t( 'pick_a_model' ) }</Title>

        { /* ── Models already on this device: one click, no download ── */ }
        { cached_models.length > 0 && <>
            <SectionHeader>
                <SectionTitle>{ t( 'on_this_device_section' ) }</SectionTitle>
                <SectionSubtitle>{ t( 'on_this_device_subtitle' ) }</SectionSubtitle>
            </SectionHeader>

            <ModelList data-testid="cached-model-list">
                { cached_models.map( model => <CachedRow key={ model.id } data-testid={ `cached-model-${ model.id }` }>
                    <OptionInfo>
                        <OptionName>
                            <HardDrive size={ 14 } />
                            { model.is_tpn_winner && model.tpn_competition
                                ? t( 'tpn_winner_label', { competition: model.tpn_competition } )
                                : model.name }
                        </OptionName>
                        <OptionMeta>{ friendly_meta( model ) }</OptionMeta>
                    </OptionInfo>
                    <LoadButton
                        type="button"
                        data-testid={ `use-cached-${ model.id }` }
                        onClick={ () => use_cached_model( model.id ) }
                    >
                        { model.id === active_model_id ? t( 'continue_with_model' ) : t( 'use_model' ) }
                    </LoadButton>
                </CachedRow> ) }
            </ModelList>
        </> }

        { /* ── TPN winners: the primary choice whenever any exist ── */ }
        { ( tpn_loading || winners.length > 0 ) && <>
            <SectionHeader>
                <SectionTitle>{ t( 'tpn_winner_models_section' ) }</SectionTitle>
                <SectionSubtitle>{ t( 'tpn_winner_models_subtitle' ) }</SectionSubtitle>
            </SectionHeader>

            <Subtitle>{ t( 'tpn_winner_subtitle' ) }</Subtitle>
        </> }

        { tpn_loading && <MemoryWarning data-testid="tpn-models-loading">
            <Spinner size={ 14 } />
            { t( 'loading_tpn_winners' ) }
        </MemoryWarning> }

        { /* ── Low free RAM warning (Electron only) ── */ }
        { low_memory && <LowMemoryWarning>
            <AlertTriangle size={ 16 } />
            <span>{ t( 'low_memory_warning', {
                free: format_file_size( free_bytes ),
                needed: format_file_size( model_needs ),
            } ) }</span>
        </LowMemoryWarning> }

        { winners.length > 0 && <ModelList data-testid="tpn-model-list">
            { winners.map( model => {
                const is_selected = !custom_model && model.id === selected_model_id

                return <ModelOption
                    key={ model.id }
                    data-testid={ `model-option-${ model.id }` }
                    $active={ is_selected }
                    aria-pressed={ is_selected }
                    onClick={ () => handle_select( model.id ) }
                >
                    <OptionInfo>
                        <OptionName>
                            <Sparkles size={ 14 } />
                            { t( 'tpn_winner_label', { competition: model.tpn_competition || `TPN` } ) }
                        </OptionName>
                        <OptionMeta>{ model.hugging_face_repo }</OptionMeta>
                        <OptionMeta>
                            { model.quantization || t( 'unknown_quantization' ) }
                            { ` - ${ format_file_size( model.file_size_bytes ) }` }
                            { model.file_name && ` - ${ model.file_name }` }
                        </OptionMeta>
                        { model.context_length && <OptionMeta>
                            { t( 'context_window_label', { context: model.context_length.toLocaleString() } ) }
                            { is_cached( model.id ) ? ` - ${ t( 'downloaded' ) }` : `` }
                        </OptionMeta> }
                    </OptionInfo>
                    { is_selected && <CheckIcon><Check size={ 16 } /></CheckIcon> }
                </ModelOption>
            } ) }
        </ModelList> }

        { /* ── Catalog fallback: device-fit recommendations ── */ }
        { show_catalog && <>
            <SectionHeader data-testid="catalog-fallback">
                <SectionTitle>{ t( 'local_models_section' ) }</SectionTitle>
                <SectionSubtitle>{ catalog_reason }</SectionSubtitle>
            </SectionHeader>

            { tpn_error && <MemoryWarning data-testid="tpn-models-error">
                <InlineActionButton type="button" onClick={ load_tpn_models }>
                    { t( 'retry_tpn_winners' ) }
                </InlineActionButton>
            </MemoryWarning> }

            { card_count > 0 && <Subtitle>
                { card_count >= 4 ? t( 'subtitle_four_cards' )
                    : card_count >= 3 ? t( 'subtitle_three_cards' )
                        : show_card_row ? t( 'subtitle_two_cards' )
                            : t( 'subtitle_single_card' ) }
            </Subtitle> }
        </> }

        { show_card_row && <CardRow>
            { recommended_cards.map( ( { key, icon: Icon, label } ) => {
                const model = recommendations[ key ]

                return <OptionCard
                    key={ key }
                    data-testid={ `model-option-${ model.id }` }
                    role="button"
                    tabIndex={ 0 }
                    aria-pressed={ !custom_model && active_model?.id === model.id }
                    $active={ !custom_model && active_model?.id === model.id }
                    $variant={ key }
                    onClick={ () => handle_select( model.id ) }
                    onKeyDown={ event => select_with_keyboard( event, model.id ) }
                >
                    <CardLabel $variant={ key }>
                        <Icon size={ 18 } />
                        { t( label ) }
                    </CardLabel>
                    { cached_badge_or_estimate( model ) }
                    { details_toggle( model.id ) }
                    <CardDetails $open={ !!details_open[ model.id ] }>
                        { model.name } — { format_file_size( model.file_size_bytes ) } — { model.quantization }
                        { model.benchmarks && <BenchmarkRow benchmarks={ model.benchmarks } /> }
                    </CardDetails>
                </OptionCard>
            } ) }
        </CardRow> }

        { show_catalog && card_count === 0 && !custom_model && <MemoryWarning data-testid="no-fitting-local-model">
            <AlertTriangle size={ 14 } />
            { t( 'no_local_model_fits' ) }
        </MemoryWarning> }

        { /* ── Single catalog pick ── */ }
        { show_catalog && card_count === 1 && summary_card( smarter, t( 'recommended_for_device' ), {
            role: `button`,
            tabIndex: 0,
            'aria-pressed': !custom_model && active_model?.id === smarter.id,
            $active: !custom_model && active_model?.id === smarter.id,
            onClick: () => handle_select( smarter.id ),
            onKeyDown: event => select_with_keyboard( event, smarter.id ),
        } ) }

        { /* ── Loaded custom model ── */ }
        { custom_model && summary_card( custom_model, t( 'custom_model_found' ), { $active: true } ) }

        { /* All alternatives in one list — catalog fallback only */ }
        { show_catalog && alternative_models.length > 0 && <>
            <ToggleButton
                data-testid="change-model-toggle"
                aria-expanded={ show_alternatives }
                onClick={ () => set_show_alternatives( !show_alternatives ) }
            >
                { t( 'choose_different_model' ) }
                { show_alternatives ? <ChevronUp size={ 14 } /> : <ChevronDown size={ 14 } /> }
            </ToggleButton>

            <ExpandPanel ref={ expand_panel_ref } $expanded={ show_alternatives }>
                <ModelList>
                    { alternative_models.map( ( model ) => {
                        const is_selected = !custom_model && model.id === active_model?.id
                        return <ModelOption
                            key={ model.id }
                            data-testid={ `model-option-${ model.id }` }
                            $active={ is_selected }
                            aria-pressed={ is_selected }
                            onClick={ () => handle_select( model.id ) }
                        >
                            <OptionInfo>
                                <OptionName>
                                    { model.name }
                                    { model.uncensored && <UncensoredTag>{ t( 'uncensored' ) }</UncensoredTag> }
                                    { model.vision && <VisionTag>{ t( 'vision' ) }</VisionTag> }
                                </OptionName>
                                <OptionMeta>
                                    { friendly_meta( model ) }
                                    { benchmark_coverage( model ) === 5 && <> · <QualityBadge>{ t( 'quality_score', { score: quality_score( model ).toFixed( 0 ) } ) }</QualityBadge></> }
                                    { is_cached( model.id ) ? ` · ✓ ${ t( 'downloaded' ) }` : `` }
                                </OptionMeta>
                            </OptionInfo>
                            { is_selected && <CheckIcon><Check size={ 16 } /></CheckIcon> }
                        </ModelOption>
                    } ) }
                </ModelList>
            </ExpandPanel>
        </> }

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
                    placeholder="hf.co/org/repo:Q4_K_M"
                    aria-label={ t( 'custom_hf_model' ) }
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

            { custom_loading && <CustomModelStatus>
                <Spinner size={ 12 } /> { t( 'common:resolving' ) }
            </CustomModelStatus> }

            { custom_error && <CustomModelStatus $error data-testid="custom-model-error">
                <AlertTriangle size={ 12 } /> { custom_error }
            </CustomModelStatus> }

        </CustomModelSection>

        { ( active_model_too_large || has_ram_override ) && <MemoryWarning data-testid="browser-ram-budget">
            { active_model_too_large && <AlertTriangle size={ 14 } /> }
            { active_model_too_large && t( 'model_memory_budget_warning', {
                required: format_file_size( model_needs ),
                budget: format_file_size( max_model_bytes ),
            } ) }
            { has_ram_override && !active_model_too_large && t( 'ram_override_budget_active', {
                budget: format_file_size( max_model_bytes ),
            } ) }
            <BrowserRamOverride data-testid="model-select-ram-override" />
        </MemoryWarning> }

        { active_uses_external_file && !active_is_cached && <MemoryWarning>
            <HardDrive size={ 14 } />
            { t( 'large_model_external_storage' ) }
        </MemoryWarning> }

        { /* ── Download action + step progress (below all model sections) ── */ }
        <DownloadButton
            data-testid="model-select-confirm-btn"
            onClick={ handle_download }
            disabled={ !active_model || active_model_too_large }
        >
            { active_model
                ? active_is_cached ? t( 'start_chatting' )
                    : active_uses_external_file ? t( 'choose_save_location' )
                        : t( 'download_and_start' )
                : t( 'select_model_to_continue' ) } <ArrowRight size={ 18 } />
        </DownloadButton>

        <StepIndicator data-testid="step-indicator">
            <StepDot $done />
            <StepLine $done />
            <StepDot $active />
            <StepLine />
            <StepDot />
        </StepIndicator>

        <SettingsModal
            is_open={ settings_open }
            on_close={ () => set_settings_open( false ) }
        />

    </Container>

}
