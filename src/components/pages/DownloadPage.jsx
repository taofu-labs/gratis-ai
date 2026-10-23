import { useState, useEffect, useRef, useCallback } from 'react'
import styled, { keyframes } from 'styled-components'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { X, CheckCircle, LoaderCircle } from 'lucide-react'
import { log } from 'mentie'
import { discard_browser_partial_download, download_model, is_model_cached, is_projector_cached } from '../../utils/model_download'
import { format_file_size } from '../../utils/model_catalog'
import { storage_key } from '../../utils/branding'
import { create_download_eta_estimator, format_download_duration } from '../../utils/network_speed'
import use_llm from '../../hooks/use_llm'
import ModelLoadStage from '../atoms/ModelLoadStage'

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

const spin = keyframes`
    to { transform: rotate( 360deg ); }
`

const LoadingSpinner = styled.div`
    display: flex;
    color: ${ ( { theme } ) => theme.colors.accent };
    margin-bottom: ${ ( { theme } ) => theme.spacing.md };
    animation: ${ spin } 1s linear infinite;

    @media ( prefers-reduced-motion: reduce ) {
        animation: none;
    }
`

const SuccessIcon = styled.div`
    color: ${ ( { theme } ) => theme.colors.success };
    animation: ${ fade_in } 0.3s ease-out;

    @media ( prefers-reduced-motion: reduce ) {
        animation: none;
    }
`

/**
 * Download page - shows model download progress with friendly feedback,
 * then loads the model into memory before handing over to chat.
 * @returns {JSX.Element}
 */
export default function DownloadPage() {

    const navigate = useNavigate()
    const location = useLocation()
    const { t } = useTranslation( 'models' )
    const { load_model, unload_model } = use_llm()
    const model = location.state?.model
    const storage_mode = location.state?.storage_mode || `opfs`
    const return_to = location.state?.return_to || `/chat`

    const [ progress, set_progress ] = useState( { progress: 0, bytes_loaded: 0, bytes_total: 0, status: t( 'preparing' ) } )
    const [ error, set_error ] = useState( null )
    const [ phase, set_phase ] = useState( `downloading` )
    const [ resumed_from, set_resumed_from ] = useState( 0 )
    // The model is already here; only its vision projector is missing
    const [ adding_projector, set_adding_projector ] = useState( false )
    const adding_projector_ref = useRef( false )
    const abort_ref = useRef( null )

    // Set on cancel or unmount: nothing may navigate or persist afterwards
    const cancelled_ref = useRef( false )

    // Observed-throughput ETA, kept in a ref so progress does not re-render per chunk
    const eta_ref = useRef( create_download_eta_estimator() )

    // Guard against StrictMode double-mount starting two downloads
    const download_started_ref = useRef( false )

    // Throttle progress updates to ~4fps to prevent jitter from rapid re-renders
    const last_update_ref = useRef( 0 )
    const pending_progress_ref = useRef( null )
    const raf_ref = useRef( null )
    const redirect_timer_ref = useRef( null )

    const on_complete = useCallback( async () => {

        if( cancelled_ref.current || !model ) return

        localStorage.setItem( storage_key( `active_model_id` ), model.id )

        // Load into memory here so the user sees stages instead of a bare spinner.
        // A load failure still hands over: the chat page owns load-error recovery.
        set_phase( `loading` )
        log.info( `[download] Complete, loading ${ model.id }` )
        try {
            // A loaded copy without its new projector must load again to see images
            if( adding_projector_ref.current ) await unload_model()
            await load_model( model.id )
        } catch ( load_error ) {
            log.warn( `[download] Model load after download failed:`, load_error?.message )
        }

        if( cancelled_ref.current ) return

        // Brief success flash before navigating
        set_phase( `complete` )
        redirect_timer_ref.current = setTimeout( () => {
            if( !cancelled_ref.current ) navigate( return_to, { replace: true } )
        }, 800 )

    }, [ model, navigate, return_to, load_model, unload_model ] )

    // Unmount = cancel: abort the pipeline and forbid any later navigation.
    // Reset on (re)mount so StrictMode's simulated unmount does not stick.
    useEffect( () => {
        cancelled_ref.current = false
        return () => {
            cancelled_ref.current = true
            abort_ref.current?.abort()
            if( raf_ref.current ) cancelAnimationFrame( raf_ref.current )
            clearTimeout( redirect_timer_ref.current )
        }
    }, [] )

    useEffect( () => {

        if( !model ) {
            navigate( `/select-model`, { replace: true } )
            return
        }

        // Prevent StrictMode double-mount from starting two concurrent downloads
        if( download_started_ref.current ) return
        download_started_ref.current = true

        // Check if already cached (also validates the source repo/file match)
        // Complete = language model plus vision projector when the catalog lists one
        const check_install = async () => {
            const model_cached = await is_model_cached( model.id, model.hugging_face_repo, model.file_name )
            const projector_cached = model_cached && await is_projector_cached( model )
            return { model_cached, cached: model_cached && projector_cached }
        }

        check_install().then( ( { model_cached, cached } ) => {

            if( cancelled_ref.current ) return
            adding_projector_ref.current = model_cached && !cached
            set_adding_projector( adding_projector_ref.current )

            if( cached ) {
                log.info( `[download] Model already cached, skipping` )
                on_complete()
                return
            }

            // Start download
            const controller = new AbortController()
            abort_ref.current = controller
            eta_ref.current = create_download_eta_estimator()

            // Throttled progress handler — updates state at most every 250ms
            const on_progress = ( prog ) => {

                if( controller.signal.aborted ) return

                // The download layer says explicitly when OPFS held a resumable prefix
                if( prog.resumed_from > 0 ) set_resumed_from( prog.resumed_from )

                // Always track throughput in the ref (no re-render); hashing is not throughput
                if( prog.verifying === undefined ) eta_ref.current.update( prog )

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
                    if( controller.signal.aborted ) return
                    // Flush final progress so the bar shows 100% before transitioning
                    if( pending_progress_ref.current ) set_progress( pending_progress_ref.current )
                    on_complete()
                } )
                .catch( err => {
                    if( err.name !== `AbortError` && !controller.signal.aborted ) {
                        set_error( err.message )
                    }
                } )

        } ).catch( err => {
            if( !cancelled_ref.current ) set_error( err.message )
        } )

    }, [ model, navigate, on_complete, storage_mode ] )

    const handle_cancel = () => {
        log.info( `[download] Aborted by user` )
        cancelled_ref.current = true
        abort_ref.current?.abort()

        // Cancel means discard, even after a network error left a resumable prefix
        if( model ) discard_browser_partial_download( model ).catch( discard_error => {
            log.warn( `[download] Could not discard partial download:`, discard_error?.message )
        } )

        navigate( `/select-model`, { replace: true } )
    }

    if( !model ) return null

    const eta_state = eta_ref.current.snapshot()
    const verifying = progress.verifying !== undefined

    // Remaining time from observed throughput, shown once beside the bar
    const get_eta = () => {
        const { eta_seconds } = eta_state
        if( verifying ) return ``
        if( !Number.isFinite( eta_seconds ) || eta_seconds <= 0 || progress.bytes_total <= 0 ) return ``

        return t( `common:eta_remaining`, {
            duration: format_download_duration( eta_seconds, t ),
        } )
    }

    const get_speed_feedback = () => {
        const { bps, is_slowed } = eta_state
        if( verifying ) return t( `download_verifying`, { percent: Math.round( progress.verifying * 100 ) } )
        if( is_slowed ) return t( `download_speed_limited` )
        if( bps ) return t( `download_speed`, { speed: format_file_size( bps ) } )
        if( resumed_from > 0 ) return t( `download_resuming`, { size: format_file_size( resumed_from ) } )
        return ``
    }

    const percent = Math.round( progress.progress * 100 )
    const eta = get_eta()
    const speed_feedback = get_speed_feedback()
    const show_stabilizing = !eta && !verifying && progress.bytes_loaded > 0 && progress.progress < 1

    // Show success state briefly
    if( phase === `complete` ) {
        return <Container>
            <SuccessIcon><CheckCircle size={ 48 } /></SuccessIcon>
            <Title style={ { marginTop: `1rem` } }>{ t( 'ready_to_chat' ) }</Title>
        </Container>
    }

    // Weights are on disk; now they are read into memory
    if( phase === `loading` ) {
        return <Container data-testid="download-loading-model">
            <StepIndicator data-testid="step-indicator">
                <StepDot $done />
                <StepLine $done />
                <StepDot $done />
                <StepLine $done />
                <StepDot $done />
            </StepIndicator>
            <Title>{ t( 'preparing_your_model' ) }</Title>
            <StatusMessage>{ t( 'preparing_your_model_detail', { name: model.name } ) }</StatusMessage>
            <LoadingSpinner aria-hidden="true"><LoaderCircle size={ 28 } /></LoadingSpinner>
            <ModelLoadStage />
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

        <Title>{ t( adding_projector ? 'adding_image_support' : 'downloading_your_model' ) }</Title>
        <StatusMessage>
            { t( adding_projector ? 'adding_image_support_detail' : 'one_time_download', { name: model.name } ) }
        </StatusMessage>

        { error && <ErrorText>{ error }</ErrorText> }

        <PercentText>{ percent }%</PercentText>

        <ProgressContainer>
            <ProgressBar data-testid="download-progress-bar">
                <ProgressFill $progress={ progress.progress } />
            </ProgressBar>
            <ProgressDetails>
                <span>{ format_file_size( progress.bytes_loaded ) } / { format_file_size( progress.bytes_total ) }</span>
                <span data-testid="download-eta">{ eta || ( show_stabilizing ? t( `download_eta_stabilizing` ) : `` ) }</span>
            </ProgressDetails>
        </ProgressContainer>

        { /* Always render to reserve space and avoid layout shift */ }
        <ETAText data-testid="download-speed">{ speed_feedback }</ETAText>

        <CancelButton onClick={ handle_cancel } data-testid="cancel-download-btn">
            <X size={ 16 } />
            { t( 'cancel_download' ) }
        </CancelButton>

    </Container>

}
