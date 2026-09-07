import { useState, useEffect, useRef, useCallback } from 'react'
import styled, { keyframes } from 'styled-components'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { X, CheckCircle } from 'lucide-react'
import { log } from 'mentie'
import { download_model, is_model_cached } from '../../utils/model_download'
import { format_file_size } from '../../utils/model_catalog'
import { storage_key } from '../../utils/branding'
import { format_download_duration } from '../../utils/network_speed'

const SPEED_SAMPLE_WINDOW_MS = 30_000
const STABLE_SPEED_WINDOW_MS = 10_000
const SHORT_SPEED_WINDOW_MS = 5_000
const SPEED_SMOOTHING = 0.18
const ETA_SMOOTHING = 0.22
const ONE_MIB = 1024 ** 2

const Container = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: ${ ( { theme } ) => theme.spacing.xl };
    text-align: center;
`

const Title = styled.h1`
    font-size: clamp( 1.5rem, 1.2rem + 1.5vw, 2rem );
    color: ${ ( { theme } ) => theme.colors.text };
    border-bottom: 3px solid ${ ( { theme } ) => theme.colors.accent };
    margin-bottom: 2rem;
`

const StatusMessage = styled.p`
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    margin-bottom: ${ ( { theme } ) => theme.spacing.lg };
    font-size: 0.95rem;
    max-width: 400px;
    line-height: 1.5;
`

const ProgressContainer = styled.div`
    width: 100%;
    max-width: 400px;
    margin-bottom: ${ ( { theme } ) => theme.spacing.md };
`

const ProgressBar = styled.div`
    width: 100%;
    height: 8px;
    background: ${ ( { theme } ) => theme.colors.border_subtle };
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    overflow: hidden;
`

// Width changes hundreds of times during a multi-gigabyte download. Keep it
// inline so styled-components does not mint a new generated class per update.
const ProgressFill = styled.div.attrs( ( { $progress } ) => ( {
    style: { width: `${ $progress * 100 }%` },
} ) )`
    height: 100%;
    background: ${ ( { theme } ) => theme.colors.accent };
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    transition: width 0.3s ease;
`

const ProgressDetails = styled.div`
    display: flex;
    justify-content: space-between;
    margin-top: ${ ( { theme } ) => theme.spacing.sm };
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    font-variant-numeric: tabular-nums;
`

const PercentText = styled.span`
    font-weight: 600;
    font-size: 1.5rem;
    color: ${ ( { theme } ) => theme.colors.text };
    margin-bottom: ${ ( { theme } ) => theme.spacing.sm };
    font-variant-numeric: tabular-nums;
    min-width: 4.5ch;
    text-align: center;
`

const ETAText = styled.p`
    font-size: 0.85rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    margin-bottom: ${ ( { theme } ) => theme.spacing.lg };
    min-height: 1.3em;
`

const CancelButton = styled.button`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.md }` };
    color: ${ ( { theme } ) => theme.colors.text_muted };
    font-size: 0.85rem;
    transition: color 0.15s;
    min-height: 2.75rem;

    &:hover {
        color: ${ ( { theme } ) => theme.colors.error };
    }
`

const ErrorText = styled.p`
    color: ${ ( { theme } ) => theme.colors.error };
    margin-bottom: ${ ( { theme } ) => theme.spacing.md };
`

// Step progress indicator
const StepIndicator = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    margin-bottom: ${ ( { theme } ) => theme.spacing.xl };
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

// Success animation
const fade_in = keyframes`
    from { opacity: 0; transform: scale( 0.9 ); }
    to { opacity: 1; transform: scale( 1 ); }
`

const SuccessIcon = styled.div`
    color: ${ ( { theme } ) => theme.colors.success };
    animation: ${ fade_in } 0.3s ease-out;

    @media ( prefers-reduced-motion: reduce ) {
        animation: none;
    }
`

/**
 * Download page - shows model download progress with friendly feedback
 * @returns {JSX.Element}
 */
export default function DownloadPage() {

    const navigate = useNavigate()
    const location = useLocation()
    const { t } = useTranslation( 'models' )
    const model = location.state?.model
    const storage_mode = location.state?.storage_mode || `opfs`
    const return_to = location.state?.return_to || `/chat`

    const [ progress, set_progress ] = useState( { progress: 0, bytes_loaded: 0, bytes_total: 0, status: t( 'preparing' ) } )
    const [ error, set_error ] = useState( null )
    const [ is_complete, set_is_complete ] = useState( false )
    const abort_ref = useRef( null )

    // Track download speed for ETA calculation
    const speed_ref = useRef( {
        start_time: null,
        samples: [],
        display_bps: null,
        eta_seconds: null,
        is_slowed: false,
    } )

    // Guard against StrictMode double-mount starting two downloads
    const download_started_ref = useRef( false )

    // Throttle progress updates to ~4fps to prevent jitter from rapid re-renders
    const last_update_ref = useRef( 0 )
    const pending_progress_ref = useRef( null )
    const raf_ref = useRef( null )

    const on_complete = useCallback( () => {

        // Save active model ID to localStorage
        if( model ) {
            localStorage.setItem( storage_key( `active_model_id` ), model.id )
        }

        // Brief success flash before navigating
        log.info( `[download] Complete, redirecting to chat` )
        set_is_complete( true )
        setTimeout( () => navigate( return_to, { replace: true } ), 800 )

    }, [ model, navigate, return_to ] )

    const update_speed_metrics = useCallback( ( prog ) => {

        const bytes_loaded = Number( prog.bytes_loaded )
        const bytes_total = Number( prog.bytes_total ) || model?.file_size_bytes || 0
        if( !Number.isFinite( bytes_loaded ) || bytes_loaded <= 0 ) return

        const time = Date.now()
        const metrics = speed_ref.current
        metrics.start_time ??= time

        const previous = metrics.samples.at( -1 )
        if( previous && bytes_loaded < previous.bytes ) {
            metrics.samples = []
            metrics.display_bps = null
            metrics.eta_seconds = null
            metrics.is_slowed = false
        }

        metrics.samples.push( { time, bytes: bytes_loaded } )
        metrics.samples = metrics.samples
            .filter( sample => time - sample.time <= SPEED_SAMPLE_WINDOW_MS )
            .slice( -160 )

        const stable_anchor = [ ...metrics.samples ].reverse()
            .find( sample => time - sample.time >= STABLE_SPEED_WINDOW_MS )
            || metrics.samples[ 0 ]
        const stable_elapsed_ms = time - stable_anchor.time
        const stable_bytes = bytes_loaded - stable_anchor.bytes

        if( stable_elapsed_ms >= 1_500 && stable_bytes >= ONE_MIB / 4 ) {
            const rolling_bps = stable_bytes / stable_elapsed_ms * 1000
            const total_elapsed_ms = Math.max( 1, time - metrics.start_time )
            const total_bps = bytes_loaded / total_elapsed_ms * 1000
            const observed_bps = stable_elapsed_ms < STABLE_SPEED_WINDOW_MS
                ? Math.min( rolling_bps, total_bps )
                : rolling_bps

            metrics.display_bps = metrics.display_bps
                ? metrics.display_bps * ( 1 - SPEED_SMOOTHING ) + observed_bps * SPEED_SMOOTHING
                : observed_bps
        }

        const short_anchor = [ ...metrics.samples ].reverse()
            .find( sample => time - sample.time >= SHORT_SPEED_WINDOW_MS )
            || metrics.samples[ 0 ]
        const short_elapsed_ms = time - short_anchor.time
        const short_bytes = bytes_loaded - short_anchor.bytes
        const short_bps = short_elapsed_ms >= 2_000 && short_bytes > 0
            ? short_bytes / short_elapsed_ms * 1000
            : null

        metrics.is_slowed = Boolean(
            metrics.display_bps
            && short_bps
            && time - metrics.start_time >= 20_000
            && bytes_total > bytes_loaded
            && short_bps < metrics.display_bps * 0.4
        )

        if( bytes_total > bytes_loaded && metrics.display_bps > 0 ) {
            const raw_eta_seconds = ( bytes_total - bytes_loaded ) / metrics.display_bps
            if( metrics.eta_seconds === null ) {
                metrics.eta_seconds = raw_eta_seconds
            } else {
                const bounded_eta = Math.max(
                    metrics.eta_seconds * 0.7,
                    Math.min( raw_eta_seconds, metrics.eta_seconds * 1.4 ),
                )
                metrics.eta_seconds = metrics.eta_seconds * ( 1 - ETA_SMOOTHING ) + bounded_eta * ETA_SMOOTHING
            }
        } else if( bytes_total > 0 && bytes_loaded >= bytes_total ) {
            metrics.eta_seconds = 0
            metrics.is_slowed = false
        }

    }, [ model?.file_size_bytes ] )

    useEffect( () => {

        if( !model ) {
            navigate( `/select-model`, { replace: true } )
            return
        }

        // Prevent StrictMode double-mount from starting two concurrent downloads
        if( download_started_ref.current ) return
        download_started_ref.current = true

        // Check if already cached (also validates the source repo/file match)
        is_model_cached( model.id, model.hugging_face_repo, model.file_name ).then( cached => {

            if( cached ) {
                log.info( `[download] Model already cached, skipping` )
                on_complete()
                return
            }

            // Start download
            const controller = new AbortController()
            abort_ref.current = controller
            speed_ref.current = {
                start_time: Date.now(),
                samples: [],
                display_bps: null,
                eta_seconds: null,
                is_slowed: false,
            }

            // Throttled progress handler — updates state at most every 250ms
            const on_progress = ( prog ) => {

                // Always track speed samples in the ref (no re-render)
                if( prog.bytes_loaded > 0 ) {
                    update_speed_metrics( prog )
                }

                // Stash latest progress, only flush to state at throttled intervals
                pending_progress_ref.current = prog
                const now = Date.now()
                if( now - last_update_ref.current < 250 ) return

                last_update_ref.current = now
                if( raf_ref.current ) cancelAnimationFrame( raf_ref.current )
                raf_ref.current = requestAnimationFrame( () => {
                    if( pending_progress_ref.current ) {
                        set_progress( pending_progress_ref.current )
                    }
                } )
            }

            download_model( model, on_progress, controller.signal, { storage_mode } )
                .then( () => {
                    // Flush final progress so the bar shows 100% before transitioning
                    if( pending_progress_ref.current ) set_progress( pending_progress_ref.current )
                    on_complete()
                } )
                .catch( err => {
                    if( err.name !== `AbortError` ) {
                        set_error( err.message )
                    }
                } )

        } )

        return () => {
            if( abort_ref.current ) abort_ref.current.abort()
            if( raf_ref.current ) cancelAnimationFrame( raf_ref.current )
        }

    }, [ model, navigate, on_complete, storage_mode, update_speed_metrics ] )

    const handle_cancel = () => {
        log.info( `[download] Aborted by user` )
        if( abort_ref.current ) abort_ref.current.abort()
        navigate( `/select-model`, { replace: true } )
    }

    // Calculate ETA from speed samples
    const get_eta = () => {
        const remaining_seconds = speed_ref.current.eta_seconds
        if( !Number.isFinite( remaining_seconds ) || remaining_seconds <= 0 || progress.bytes_total <= 0 ) return ``

        return t( `common:eta_remaining`, {
            duration: format_download_duration( remaining_seconds, t ),
        } )
    }

    const get_speed_feedback = () => {
        const { display_bps, is_slowed } = speed_ref.current
        if( is_slowed ) return t( `download_speed_limited` )
        if( display_bps ) {
            return t( `download_speed`, {
                speed: format_file_size( display_bps ),
            } )
        }
        if( progress.bytes_loaded > 0 && progress.bytes_total > 0 ) return t( `download_eta_stabilizing` )
        return ``
    }

    if( !model ) return null

    const percent = Math.round( progress.progress * 100 )
    const eta = get_eta()
    const speed_feedback = get_speed_feedback()

    // Show success state briefly
    if( is_complete ) {
        return <Container>
            <SuccessIcon><CheckCircle size={ 48 } /></SuccessIcon>
            <Title style={ { marginTop: `1rem` } }>{ t( 'ready_to_chat' ) }</Title>
        </Container>
    }

    return <Container>

        { /* Step progress */ }
        <StepIndicator data-testid="step-indicator">
            <StepDot $done />
            <StepLine $done />
            <StepDot $done />
            <StepLine $done />
            <StepDot $active />
        </StepIndicator>

        <Title>{ t( 'downloading_your_model' ) }</Title>
        <StatusMessage>
            { t( 'one_time_download', { name: model.name } ) }
        </StatusMessage>

        { error && <ErrorText>{ error }</ErrorText> }

        <PercentText>{ percent }%</PercentText>

        <ProgressContainer>
            <ProgressBar data-testid="download-progress-bar">
                <ProgressFill $progress={ progress.progress } />
            </ProgressBar>
            <ProgressDetails>
                <span>{ format_file_size( progress.bytes_loaded ) } / { format_file_size( progress.bytes_total ) }</span>
                { eta ? <span>{ eta }</span> : progress.bytes_loaded > 0 && <span>{ t( `download_eta_stabilizing` ) }</span> }
            </ProgressDetails>
        </ProgressContainer>

        { /* Always render to reserve space and avoid layout shift */ }
        <ETAText>{ speed_feedback }</ETAText>

        <CancelButton onClick={ handle_cancel }>
            <X size={ 16 } />
            { t( 'cancel_download' ) }
        </CancelButton>

    </Container>

}
