import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import styled from 'styled-components'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { log } from 'mentie'
import toast from 'react-hot-toast'
import { ChevronDown, ChevronUp, ArrowLeft, AlertTriangle, LoaderCircle, Link, HardDrive, Settings, List, Trash2, Image, ImageOff, ShieldCheck, MessageCircleQuestion } from 'lucide-react'
import use_device_capabilities from '../../hooks/use_device_capabilities'
import use_device_speed_probe from '../../hooks/use_device_speed_probe'
import use_model_manager from '../../hooks/use_model_manager'
import use_speed_estimate from '../../hooks/use_speed_estimate'
import use_llm_store from '../../stores/llm_store'
import BrowserRamOverride from '../atoms/BrowserRamOverride'
import Button from '../atoms/Button'
import LanguageSelector from '../molecules/LanguageSelector'
import SettingsModal from '../molecules/SettingsModal'
import ModelHero from '../molecules/ModelHero'
import WizardQuestion, { WizardSummary } from '../molecules/ModelWizard'
import SpeedGauge from '../atoms/SpeedGauge'
import { read_speed_mode, read_wizard_answers, write_speed_mode, write_wizard_answers } from '../../utils/speed_mode'
import ModelBrowser from '../molecules/ModelBrowser'
import {
    build_device_profile,
    read_browser_ram_override,
    supports_browser_ram_override,
} from '../../utils/device_detection'
import {
    DEFAULT_PREFERENCES,
    MODEL_CATALOG,
    check_fit,
    describe_models,
    estimate_decode_speed,
    estimate_reply_speed,
    fit_level,
    format_file_size,
    get_model_by_id,
    has_image_input,
    model_download_bytes,
    quality_score,
    runtime_memory,
    select_picker_models,
    select_mode_models,
    SPEED_MODES,
    NOTICEABLE_QUALITY_GAP,
    speed_band,
} from '../../utils/model_catalog'
import { build_download_url, parse_hf_url, resolve_hf_model } from '../../utils/hf_url_parser'
import { resolve_tpn_winner_models } from '../../utils/tpn_winner_models'
import {
    browser_storage_free_bytes,
    choose_external_model_file,
    request_persistent_storage,
    should_use_external_model_file,
} from '../../utils/external_model_files'
import { EVENTS, storage_key } from '../../utils/branding'
import { format_download_duration, get_speed_estimate } from '../../utils/network_speed'

// Positioned, so the corner actions scroll away with the page instead of floating over it
const Container = styled.div`
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    min-height: 0;
    padding: ${ ( { theme } ) => theme.spacing.xl } ${ ( { theme } ) => theme.spacing.md };
    overflow-y: auto;

    /* Flex spacers center content when it fits, collapse when it overflows */
    &::before, &::after {
        content: '';
        flex: 1 0 0px;
    }
`

const PageActions = styled.div`
    position: absolute;
    top: ${ ( { theme } ) => theme.spacing.md };
    right: ${ ( { theme } ) => theme.spacing.md };
    z-index: 10;
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
`

const BackActions = styled.div`
    position: absolute;
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

    &:hover { color: ${ ( { theme } ) => theme.colors.text }; }
`

const Title = styled.h1`
    font-size: clamp( 1.5rem, 1.2rem + 1.5vw, 2rem );
    color: ${ ( { theme } ) => theme.colors.text };
    border-bottom: 3px solid ${ ( { theme } ) => theme.colors.accent };
    margin: ${ ( { theme } ) => theme.spacing.xl } 0 ${ ( { theme } ) => theme.spacing.lg };
`

// One column for everything below the title: hero, adjust, browse
const Column = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.md };
    width: 100%;
    max-width: 520px;
`

const Section = styled.section`
    width: 100%;
`

const SectionTitle = styled.h2`
    font-size: 1rem;
    font-weight: 600;
    color: ${ ( { theme } ) => theme.colors.text };
`

const SectionSubtitle = styled.p`
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    margin-bottom: ${ ( { theme } ) => theme.spacing.sm };
`

const ModelList = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    width: 100%;
`

// Cached rows hold their own action button, so the row itself is not a button
const CachedRow = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    width: 100%;
    padding: ${ ( { theme } ) => theme.spacing.sm } ${ ( { theme } ) => theme.spacing.md };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
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

    svg { flex-shrink: 0; }
`

const OptionMeta = styled.div`
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    line-height: 1.45;
    overflow-wrap: anywhere;
`

const Disclosure = styled.button`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    min-height: 2.75rem;
    font-size: 0.9rem;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    transition: color 0.15s;

    &:hover { color: ${ ( { theme } ) => theme.colors.text }; }
`

const Notice = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.warning };
    text-align: center;
`

// Low free RAM warning banner (Electron only)
const LowMemoryWarning = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    padding: ${ ( { theme } ) => theme.spacing.md };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    background: ${ ( { theme } ) => `${ theme.colors.warning }18` };
    border: 1px solid ${ ( { theme } ) => theme.colors.warning };
    color: ${ ( { theme } ) => theme.colors.text };
    font-size: 0.85rem;
    line-height: 1.45;
    text-align: center;
    width: 100%;

    svg { flex-shrink: 0; color: ${ ( { theme } ) => theme.colors.warning }; }
`

const Quiet = styled.div`
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

const EmptyTitle = styled.p`
    font-size: 1rem;
    color: ${ ( { theme } ) => theme.colors.text };
`

const EmptyBody = styled.p`
    font-size: 0.85rem;
    line-height: 1.45;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
`

const RelaxedList = styled.div`
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: ${ ( { theme } ) => theme.spacing.xs };
`

// Custom model input section
const CustomModelSection = styled.div`
    padding-top: ${ ( { theme } ) => theme.spacing.md };
    border-top: 1px solid ${ ( { theme } ) => theme.colors.border };
    width: 100%;
`

const CustomModelLabel = styled.label`
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
`

const LoadButton = styled( Button ).attrs( { $variant: `secondary` } )``

// Quiet trash icon; the first tap arms it into a red "Delete" label
const DeleteButton = styled.button`
    display: flex;
    align-items: center;
    justify-content: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    min-width: 2.75rem;
    min-height: 2.75rem;
    padding: 0 ${ ( { theme } ) => theme.spacing.sm };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    font-size: 0.8rem;
    font-weight: 500;
    color: ${ ( { theme, $confirming } ) => $confirming ? theme.colors.error : theme.colors.text_muted };
    transition: color 0.15s, background 0.15s;

    &:hover:not(:disabled) {
        color: ${ ( { theme } ) => theme.colors.error };
        background: ${ ( { theme } ) => theme.colors.surface_hover };
    }

    &:disabled { opacity: 0.5; }
`

const InlineActionButton = styled.button`
    min-height: 2.75rem;
    color: ${ ( { theme } ) => theme.colors.accent };
    font-size: 0.85rem;
    font-weight: 600;
    text-align: left;

    &:hover { text-decoration: underline; }
`

const CustomModelStatus = styled.div`
    font-size: 0.8rem;
    margin-top: ${ ( { theme } ) => theme.spacing.xs };
    color: ${ ( { $error, theme } ) => $error ? theme.colors.error : theme.colors.text_muted };
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
`

const Spinner = styled( LoaderCircle )`
    animation: spin 1s linear infinite;
    @keyframes spin { to { transform: rotate( 360deg ); } }
`

// Step progress indicator
const StepIndicator = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    margin-top: ${ ( { theme } ) => theme.spacing.lg };
`

const StepDot = styled.div`
    width: 8px;
    height: 8px;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    background: ${ ( { theme, $active, $done } ) => $done || $active ? theme.colors.accent : theme.colors.border };
`

const StepLine = styled.div`
    width: 24px;
    height: 2px;
    background: ${ ( { theme, $done } ) => $done ? theme.colors.accent : theme.colors.border };
`


// ─── Plain-language helpers ─────────────────────────────────────────────────────

// Bound TPN discovery so a stalled connection falls back instead of spinning forever
const TPN_DISCOVERY_TIMEOUT_MS = 10_000

const timed_fetch = ( url, options = {} ) =>
    fetch( url, { ...options, signal: AbortSignal.timeout( TPN_DISCOVERY_TIMEOUT_MS ) } )

const has_parameter_label = ( { parameters_label } ) => !!parameters_label && parameters_label !== `Custom`

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

const BAND_ORDER = [ `slow`, `steady`, `quick` ]

const scroll_into_view = element => {
    const reduced = window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches
    element?.scrollIntoView( { behavior: reduced ? `instant` : `smooth`, block: `nearest` } )
}


/**
 * Model selection page. One calm recommendation (TPN winner when one fits,
 * else the catalog's device-aware pick), optional tailoring, and an expert
 * view of the whole catalog. Downloaded models stay one click away.
 * @returns {JSX.Element}
 */
export default function ModelSelectPage() {

    const navigate = useNavigate()
    const { t } = useTranslation( 'models' )
    const [ search_params ] = useSearchParams()

    // The conversation that sent us here (e.g. `?need=vision`); its draft waits there
    const return_to = useLocation().state?.return_to || `/chat`
    const hero_ref = useRef( null )

    // `?need=vision` arrives from "this model can't read images" prompts
    const needs_vision = search_params.get( `need` ) === `vision`
    // Reply speed is shared with the chat's gauge, so it starts from the last choice;
    // the other answers come from the last finished wizard
    const [ preferences, set_preferences ] = useState( () => ( {
        ...DEFAULT_PREFERENCES,
        ...read_wizard_answers(),
        priority: read_speed_mode(),
        ...needs_vision && { vision: true },
    } ) )

    // The wizard's open question (index), or null for the recommendation. It
    // opens until finished once; a `?need=vision` link already answered it.
    const [ question, set_question ] = useState( () => needs_vision || read_wizard_answers() ? null : 0 )
    const [ browse_open, set_browse_open ] = useState( false )
    const [ settings_open, set_settings_open ] = useState( false )

    // Unknown until measured: assume it fits, as nearly every download does
    const [ storage_free_bytes, set_storage_free_bytes ] = useState( Infinity )
    useEffect( () => {
        browser_storage_free_bytes().then( set_storage_free_bytes )
    }, [] )

    useEffect( () => {

        const handle_open_settings = () => set_settings_open( true )
        window.addEventListener( EVENTS.open_settings, handle_open_settings )
        return () => window.removeEventListener( EVENTS.open_settings, handle_open_settings )

    }, [] )

    // Device memory budget and cached model detection
    const { capabilities, max_model_bytes, is_detecting } = use_device_capabilities()
    const { cached_models, delete_model } = use_model_manager()
    const [ confirming_delete, set_confirming_delete ] = useState( null )
    const [ tpn_models, set_tpn_models ] = useState( [] )
    const [ tpn_loading, set_tpn_loading ] = useState( true )
    const [ tpn_error, set_tpn_error ] = useState( null )

    // Returning users can go straight back to their current chat
    const active_model_id = localStorage.getItem( storage_key( `active_model_id` ) )

    const is_cached = useCallback( model_id => cached_models.some( m => m.id === model_id ), [ cached_models ] )

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

    // ── What this device can run, and what we recommend ──

    // Time this browser once while it's idle; the result rescales every speed estimate
    const runtime_busy = use_llm_store( s => !!( s.loaded_model_id || s.is_loading ) )
    const speed_ratio = use_device_speed_probe( !is_detecting && capabilities?.runtime !== `electron` && !runtime_busy )

    // speed_ratio is read inside build_device_profile; listing it recomputes the profile
    const device = useMemo( () => build_device_profile( capabilities, max_model_bytes ), [ capabilities, max_model_bytes, speed_ratio ] )
    const picks = useMemo(
        () => select_picker_models( { winners: tpn_models, device, preferences } ),
        [ tpn_models, device, preferences ],
    )
    const baseline = useMemo( () => select_picker_models( { winners: tpn_models, device } ), [ tpn_models, device ] )

    // Speed modes with a distinct model under the current photo / uncensored choices.
    // The highlighted one is whichever holds the recommendation (merged modes included).
    const mode_models = useMemo( () => select_mode_models( MODEL_CATALOG, device, preferences ), [ device, preferences ] )
    const active_mode = mode_models.find( ( { model } ) => model.id === picks.pick?.id )?.priority ?? preferences.priority

    // Hold the recommendation back until discovery settles, so winners don't pop in over it
    const deciding = tpn_loading || is_detecting || !capabilities

    const catalog_rows = useMemo( () => describe_models( MODEL_CATALOG.filter( m => !m.hidden ), device ), [ device ] )
    const retired_rows = useMemo( () => describe_models( MODEL_CATALOG.filter( m => m.hidden ), device ), [ device ] )
    const winner_rows = useMemo( () => describe_models( picks.winners, device ), [ picks.winners, device ] )

    // ── The wizard: photos → topics → speed, in plain words ──

    // Speed is only a question when this device has more than one real choice
    const questions = [ `photos`, `topics`, ...mode_models.length > 1 || deciding ? [ `speed` ] : [] ]

    const finish_wizard = () => {
        write_wizard_answers( preferences )
        set_question( null )
    }

    // Answering the last question lands here, once the answer has applied
    useEffect( () => {
        if( question !== null && question >= questions.length ) finish_wizard()
    }, [ question, questions.length ] )

    // ── Selection: custom > explicit choice > recommendation ──

    const [ selected_id, set_selected_id ] = useState( null )
    const [ custom_url, set_custom_url ] = useState( `` )
    const [ custom_model, set_custom_model ] = useState( null )
    const [ custom_loading, set_custom_loading ] = useState( false )
    const [ custom_error, set_custom_error ] = useState( null )
    const [ action_error, set_action_error ] = useState( null )

    const selected_model = selected_id
        ? [ ...winner_rows, ...catalog_rows, ...retired_rows ].find( ( { model } ) => model.id === selected_id )?.model
        : null

    const recommendation = deciding ? null : picks.pick
    const active_model = custom_model || selected_model || recommendation
    const hero_kind = custom_model ? `custom`
        : selected_model && selected_model.id !== recommendation?.id ? `choice`
            : picks.from_winner ? `winner`
                : `recommended`

    const active_fit = active_model ? check_fit( active_model, device ) : null
    const active_is_cached = !!active_model && is_cached( active_model.id )
    const active_uses_external_file = !!active_model && !active_is_cached
        && should_use_external_model_file( active_model, model_download_bytes( active_model ), storage_free_bytes )

    // Adjusting tailors the recommendation, so it replaces any explicit pick
    const update_preferences = patch => {
        if( patch.priority ) write_speed_mode( patch.priority )
        set_preferences( current => ( { ...current, ...patch } ) )
        set_selected_id( null )
        set_custom_model( null )
        set_action_error( null )
    }

    const choose_model = model_id => {
        set_custom_model( null )
        set_action_error( null )
        set_selected_id( model_id )
        scroll_into_view( hero_ref.current )
    }

    const reset_choice = () => {
        set_custom_model( null )
        set_action_error( null )
        set_selected_id( null )
    }

    // ── Plain-language facts ──

    // Same host-scoped estimator the download page records into; probe only the active pick
    const speed_target_url = model_download_url( active_model )
    const { speed_bps, run_estimate } = use_speed_estimate( speed_target_url )

    useEffect( () => {
        if( deciding || !speed_target_url ) return
        const timer = setTimeout( run_estimate, 250 )
        return () => clearTimeout( timer )
    }, [ deciding, run_estimate, speed_target_url ] )

    // Size always; time only from a real measurement, never a guessed range
    const download_text = model => {

        const bytes = model_download_bytes( model )
        const size = format_file_size( bytes )
        const url = model_download_url( model )
        const bps = speed_bps || url && get_speed_estimate( url )?.bps

        if( bps ) return t( 'download_size_with_time', { size, time: format_download_duration( bytes / bps, t ) } )
        return t( 'download_size', { size } )

    }

    const device_name = t( `device_${ device.kind }` )

    // Why this model: a fit sentence for runnable models, the blocker otherwise
    const fit_reason = fit => {
        if( fit.reason === `too_big_for_runtime` ) return t( `reason_too_big_browser` )
        if( fit.reason === `untested_in_browser` ) return t( `reason_untested` )
        if( fit.reason === `needs_more_memory` ) return t( `reason_needs_memory`, {
            required: format_file_size( fit.memory ),
            budget: format_file_size( device.budget_bytes ),
        } )
        return null
    }

    const fit_sentence = fit => {
        const level = fit_level( fit, device )
        if( !level ) return fit_reason( fit )
        return device.ram_gb
            ? t( `fit_${ level }`, { ram: device.ram_gb, device: device_name } )
            : t( `fit_${ level }_unknown`, { device: device_name } )
    }

    const band_of = model => speed_band( estimate_reply_speed( model, device ) )

    // What the adjustments changed compared to the default recommendation
    const describe_change = () => {

        const from = baseline.pick
        const to = picks.pick
        if( hero_kind !== `recommended` || !from || !to || from.id === to.id ) return null

        const size_delta = model_download_bytes( to ) - model_download_bytes( from )
        const band_delta = BAND_ORDER.indexOf( band_of( to ) ) - BAND_ORDER.indexOf( band_of( from ) )
        const quality_delta = quality_score( to ) - quality_score( from )

        const changes = [
            size_delta > 0 && t( `change_bigger`, { size: format_file_size( size_delta ) } ),
            size_delta < 0 && t( `change_smaller`, { size: format_file_size( -size_delta ) } ),
            band_delta > 0 && t( `change_faster` ),
            band_delta < 0 && t( `change_slower` ),
            quality_delta >= NOTICEABLE_QUALITY_GAP && t( `change_smarter` ),
            quality_delta <= -NOTICEABLE_QUALITY_GAP && t( `change_simpler` ),
        ].filter( Boolean )

        return changes.length ? t( `change_vs_default`, { changes: changes.join( `, ` ) } ) : null

    }

    // What an answer would mean here: the model it leads to, as size and speed
    const facts_of = model => model
        ? t( `wizard_facts`, { size: format_file_size( model_download_bytes( model ) ), speed: t( `speed_${ band_of( model ) }` ) } )
        : t( `wizard_unavailable`, { device: device_name } )
    const pick_with = patch => select_picker_models( { winners: tpn_models, device, preferences: { ...preferences, ...patch } } ).pick
    // Later questions come later: photos is weighed with standard care, or a
    // saved "answers freely" would make photos look impossible here
    const option_for = ( key, patch, icon, assume = {} ) => {
        const model = !deciding && pick_with( { ...assume, ...patch } )
        return {
            key,
            patch,
            icon,
            title: t( `wizard_${ key }` ),
            body: t( `wizard_${ key }_body` ),
            facts: !deciding && facts_of( model ),
            active: Object.entries( patch ).every( ( [ field, value ] ) => preferences[ field ] === value ),
            disabled: !deciding && !model,
        }
    }

    const wizard = {
        photos: [
            option_for( `photos_no`, { vision: false }, <ImageOff size={ 20 } />, { fewer_refusals: false } ),
            option_for( `photos_yes`, { vision: true }, <Image size={ 20 } />, { fewer_refusals: false } ),
        ],
        topics: [
            option_for( `topics_careful`, { fewer_refusals: false }, <ShieldCheck size={ 20 } /> ),
            option_for( `topics_free`, { fewer_refusals: true }, <MessageCircleQuestion size={ 20 } /> ),
        ],
        // Slow → fast, each with the model it would download here (TPN winners included)
        speed: ( deciding ? SPEED_MODES : mode_models.map( ( { priority } ) => priority ) ).map( priority => ( {
            key: `speed_${ priority }`,
            patch: { priority },
            icon: <SpeedGauge mode={ priority } size={ 20 } />,
            title: t( `wizard_speed_${ priority }` ),
            body: t( `wizard_speed_${ priority }_body` ),
            facts: !deciding && facts_of( pick_with( { priority } ) ),
            active: active_mode === priority,
        } ) ),
    }

    // One tap answers and moves on
    const answer = ( id, key ) => {
        update_preferences( wizard[ id ].find( option => option.key === key ).patch )
        set_question( index => index + 1 )
    }

    const answer_labels = [
        { id: `photos`, label: t( preferences.vision ? `wizard_photos_yes_short` : `wizard_photos_no_short` ) },
        { id: `topics`, label: t( preferences.fewer_refusals ? `wizard_topics_free_short` : `wizard_topics_careful_short` ) },
        ...questions.includes( `speed` ) ? [ { id: `speed`, label: t( `wizard_speed_${ active_mode }` ) } ] : [],
    ]

    const action_label = !active_model ? t( 'select_model_to_continue' )
        : active_is_cached ? t( 'start_chatting' )
            : active_uses_external_file ? t( 'choose_save_location' )
                : t( 'download_cta', { size: format_file_size( model_download_bytes( active_model ) ) } )

    // Warn Electron users when free RAM is dangerously low for the selected model
    const free_bytes = capabilities?.memory?.free_bytes
    const model_needs = active_model ? runtime_memory( active_model ) : 0
    const low_memory = device.runtime === `electron` && free_bytes && model_needs > 0 && free_bytes < model_needs * 1.2

    const can_override_ram = supports_browser_ram_override()
    const has_ram_override = can_override_ram && !!read_browser_ram_override()

    // ── Actions ──

    // Cached copies still face the fit check: RAM overrides or devices change
    const use_cached_model = model => {
        if( !check_fit( get_model_by_id( model.id ) || model, device ).fits ) {
            set_action_error( t( 'model_does_not_fit' ) )
            return
        }
        localStorage.setItem( storage_key( `active_model_id` ), model.id )
        navigate( return_to )
    }

    // Two taps to delete: the first arms the button for a few seconds
    const handle_delete_cached = async model => {

        if( confirming_delete !== model.id ) {
            set_confirming_delete( model.id )
            setTimeout( () => set_confirming_delete( id => id === model.id ? null : id ), 5000 )
            return
        }

        set_confirming_delete( null )
        try {
            await delete_model( model.id )
            toast.success( t( `common:deleted_model`, { name: model.name } ) )
        } catch ( err ) {
            toast.error( err.message )
        }

    }

    const handle_download = async () => {

        if( !active_model ) return
        if( !active_fit.fits ) {
            set_action_error( t( 'model_does_not_fit' ) )
            return
        }

        if( active_is_cached ) return use_cached_model( active_model )

        try {
            const storage_mode = active_uses_external_file ? `external-file` : `opfs`
            if( storage_mode === `external-file` ) await choose_external_model_file( active_model )
            else request_persistent_storage()
            navigate( `/download`, { state: { model: active_model, storage_mode, return_to } } )
        } catch ( error ) {
            if( error?.name !== `AbortError` ) set_action_error( error.message || t( 'download_storage_failed' ) )
        }

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
        set_action_error( null )
        set_custom_model( null )
        set_selected_id( null )

        try {
            const model = await resolve_hf_model( parsed )
            set_custom_model( model )
            scroll_into_view( hero_ref.current )
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

    // ── Hero content when nothing fits ──

    const relaxed_label = { vision: `relaxed_without_photos`, fewer_refusals: `relaxed_without_fewer_refusals` }

    const empty_state = !deciding && !active_model && ( picks.relaxed.length
        ? <div data-testid="nothing-fits-combination">
            <EmptyTitle>{ t( `nothing_fits_title` ) }</EmptyTitle>
            <EmptyBody>{ t( `nothing_fits_body` ) }</EmptyBody>
            <RelaxedList>
                { picks.relaxed.map( ( { drop, model } ) => <InlineActionButton
                    key={ drop }
                    type="button"
                    data-testid={ `relaxed-${ drop }` }
                    onClick={ () => update_preferences( { [ drop ]: false } ) }
                >
                    { t( relaxed_label[ drop ], { name: model.name, size: format_file_size( model_download_bytes( model ) ) } ) }
                </InlineActionButton> ) }
            </RelaxedList>
        </div>
        : <EmptyBody data-testid="no-fitting-local-model">{ t( 'no_local_model_fits' ) }</EmptyBody> )

    const ram_budget = can_override_ram && <Notice data-testid="browser-ram-budget">
        { has_ram_override
            ? t( 'ram_override_budget_active', { budget: format_file_size( device.budget_bytes ) } )
            : device.automatic_bytes < device.budget_bytes
                ? t( 'ram_budget_split_hint', { comfortable: format_file_size( device.automatic_bytes ), budget: format_file_size( device.budget_bytes ) } )
                : t( 'ram_budget_hint', { budget: format_file_size( device.budget_bytes ) } ) }
        <BrowserRamOverride data-testid="model-select-ram-override" />
    </Notice>

    return <Container>

        { active_model_id && <BackActions>
            <BackButton
                data-testid="back-to-chat-btn"
                aria-label={ t( 'back_to_chat' ) }
                onClick={ () => navigate( return_to ) }
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

        <Column>

            { /* ── Models already on this device: one click, no download ── */ }
            { cached_models.length > 0 && <Section>
                <SectionTitle>{ t( 'on_this_device_section' ) }</SectionTitle>
                <SectionSubtitle>{ t( 'on_this_device_subtitle' ) }</SectionSubtitle>

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
                            onClick={ () => use_cached_model( model ) }
                        >
                            { model.id === active_model_id ? t( 'continue_with_model' ) : t( 'use_model' ) }
                        </LoadButton>
                        <DeleteButton
                            type="button"
                            data-testid={ `delete-cached-${ model.id }` }
                            $confirming={ confirming_delete === model.id }
                            aria-label={ t( 'delete_model_aria', { name: model.name } ) }
                            onClick={ () => handle_delete_cached( model ) }
                        >
                            <Trash2 size={ 16 } />
                            { confirming_delete === model.id && t( 'common:delete' ) }
                        </DeleteButton>
                    </CachedRow> ) }
                </ModelList>
            </Section> }

            { /* ── The wizard: one plain question at a time ── */ }
            { question !== null && question < questions.length && <Section>
                <WizardQuestion
                    id={ questions[ question ] }
                    index={ question }
                    total={ questions.length }
                    title={ t( `wizard_${ questions[ question ] }_title` ) }
                    hint={ t( `wizard_${ questions[ question ] }_hint`, { device: device_name } ) }
                    options={ wizard[ questions[ question ] ] }
                    on_pick={ key => answer( questions[ question ], key ) }
                    on_back={ question > 0 ? () => set_question( question - 1 ) : null }
                    on_skip={ finish_wizard }
                />
            </Section> }

            { question === null && <>

                { /* ── Low free RAM warning (Electron only) ── */ }
                { low_memory && <LowMemoryWarning>
                    <AlertTriangle size={ 16 } />
                    <span>{ t( 'low_memory_warning', {
                        free: format_file_size( free_bytes ),
                        needed: format_file_size( model_needs ),
                    } ) }</span>
                </LowMemoryWarning> }

                { /* ── The recommendation ── */ }
                <Section ref={ hero_ref }>
                    <ModelHero
                        loading={ deciding && !custom_model && !selected_model }
                        model={ active_model }
                        kind={ hero_kind }
                        reason={ active_fit && fit_sentence( active_fit ) }
                        band={ active_model && band_of( active_model ) }
                        tokens_per_second={ active_model && estimate_decode_speed( active_model, device ) }
                        photos={ has_image_input( active_model ) }
                        download_text={ active_model && download_text( active_model ) }
                        cached={ active_is_cached }
                        action_label={ action_label }
                        disabled={ !active_model || !active_fit?.fits }
                        on_confirm={ handle_download }
                        change={ describe_change() }
                        fallback={ hero_kind === `recommended` || hero_kind === `winner` ? picks.fallback : null }
                        on_fallback={ () => choose_model( picks.fallback.id ) }
                        step_up={ hero_kind === `recommended` ? picks.step_up : null }
                        step_up_tps={ picks.step_up && estimate_decode_speed( picks.step_up, device ) }
                        on_step_up={ () => choose_model( picks.step_up.id ) }
                        on_reset={ hero_kind === `choice` || hero_kind === `custom` ? reset_choice : null }
                    >
                        { empty_state }
                        { active_model && !active_fit.fits && ram_budget }
                        { active_uses_external_file && <OptionMeta>
                            { t( 'large_model_external_storage' ) }
                        </OptionMeta> }
                        { action_error && <CustomModelStatus $error data-testid="model-action-error">
                            <AlertTriangle size={ 12 } /> { action_error }
                        </CustomModelStatus> }
                    </ModelHero>
                </Section>

                { /* ── The answers behind it, each one tap from its question ── */ }
                <Section>
                    <WizardSummary answers={ answer_labels } on_edit={ id => set_question( questions.indexOf( id ) ) } />
                </Section>

                { /* ── Expert view: the whole catalog ── */ }
                <Section>
                    <Disclosure
                        type="button"
                        aria-expanded={ browse_open }
                        data-testid="browse-models-toggle"
                        onClick={ () => set_browse_open( !browse_open ) }
                    >
                        <List size={ 16 } />
                        { t( 'browse_all' ) }
                        { browse_open ? <ChevronUp size={ 14 } /> : <ChevronDown size={ 14 } /> }
                    </Disclosure>

                    { browse_open && <ModelBrowser
                        rows={ catalog_rows }
                        retired_rows={ retired_rows }
                        winner_rows={ winner_rows }
                        recommended_id={ recommendation?.id }
                        selected_id={ custom_model ? null : active_model?.id }
                        on_select={ choose_model }
                        is_cached={ is_cached }
                        fit_reason={ fit => fit_reason( fit ) || ( fit_level( fit, device ) === `tight` ? t( `reason_tight` ) : null ) }
                    >
                        { tpn_error && <Quiet data-testid="tpn-models-error">
                            { t( 'tpn_fallback_unreachable' ) }
                            <InlineActionButton type="button" onClick={ load_tpn_models }>
                                { t( 'retry_tpn_winners' ) }
                            </InlineActionButton>
                        </Quiet> }

                        { ram_budget }

                        { /* Custom HuggingFace model input */ }
                        <CustomModelSection>
                            <CustomModelLabel htmlFor="custom-model-url">
                                <Link size={ 14 } />
                                { t( 'custom_hf_model' ) }
                            </CustomModelLabel>

                            <CustomModelRow onSubmit={ handle_custom_load }>
                                <CustomModelInput
                                    id="custom-model-url"
                                    data-testid="custom-model-input"
                                    type="text"
                                    placeholder="hf.co/org/repo:Q4_K_M"
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
                    </ModelBrowser> }
                </Section>

            </> }

        </Column>

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
