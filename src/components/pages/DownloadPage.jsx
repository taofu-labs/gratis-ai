import { useState, useEffect, useRef, useCallback } from 'react'
import styled, { keyframes } from 'styled-components'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { X, CheckCircle } from 'lucide-react'
import { log } from 'mentie'
import { download_model, is_model_cached } from '../../utils/model_download'
import { format_file_size } from '../../utils/model_catalog'
import { storage_key } from '../../utils/branding'

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

const ProgressFill = styled.div`
    height: 100%;
    background: ${ ( { theme } ) => theme.colors.accent };
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    transition: width 0.3s ease;
    width: ${ ( { $progress } ) => `${ $progress * 100 }%` };
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
 * Format seconds into a friendly time estimate
 * @param {number} seconds
 * @returns {string}
 */
const format_eta = ( seconds, t ) => {
    if( seconds < 0 || !isFinite( seconds ) ) return ``
    if( t ) {
        if( seconds < 60 ) return t( 'common:format_eta_seconds', { count: Math.ceil( seconds / 5 ) * 5 } )
        const minutes = Math.ceil( seconds / 60 )
        return t( minutes !== 1 ? 'common:format_eta_minutes_plural' : 'common:format_eta_minutes', { count: minutes } )
    }
    if( seconds < 60 ) return `About ${ Math.ceil( seconds / 5 ) * 5 } seconds left`
    const minutes = Math.ceil( seconds / 60 )
    return `About ${ minutes } minute${ minutes !== 1 ? `s` : `` } left`
}

/**
 * Download page - shows model download progress with friendly feedback
 * @returns {JSX.Element}
 */
export default function DownloadPage() {

    const navigate = useNavigate()
    const location = useLocation()
    const { t } = useTranslation( 'models' )
    const model = location.state?.model
    const return_to = location.state?.return_to || `/chat`

    const [ progress, set_progress ] = useState( { progress: 0, bytes_loaded: 0, bytes_total: 0, status: t( 'preparing' ) } )
    const [ error, set_error ] = useState( null )
    const [ is_complete, set_is_complete ] = useState( false )
    const abort_ref = useRef( null )

    // Track download speed for ETA calculation
    const speed_ref = useRef( { start_time: null, samples: [] } )

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
            speed_ref.current.start_time = Date.now()

            // Throttled progress handler — updates state at most every 250ms
            const on_progress = ( prog ) => {

                // Always track speed samples in the ref (no re-render)
                if( prog.bytes_loaded > 0 ) {
                    speed_ref.current.samples.push( {
                        time: Date.now(),
                        bytes: prog.bytes_loaded,
                    } )
                    if( speed_ref.current.samples.length > 10 ) {
                        speed_ref.current.samples.shift()
                    }
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

            download_model( model, on_progress, controller.signal )
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

    }, [ model, navigate, on_complete ] )

    const handle_cancel = () => {
        log.info( `[download] Aborted by user` )
        if( abort_ref.current ) abort_ref.current.abort()
        navigate( `/select-model`, { replace: true } )
    }

    // Calculate ETA from speed samples
    const get_eta = () => {
        const { samples } = speed_ref.current
        if( samples.length < 2 || progress.bytes_total <= 0 ) return ``

        const recent = samples.at( -1 )
        const [ older ] = samples
        const elapsed_ms = recent.time - older.time
        const bytes_transferred = recent.bytes - older.bytes

        if( elapsed_ms <= 0 || bytes_transferred <= 0 ) return ``

        const speed_bps =  bytes_transferred / elapsed_ms  * 1000
        const remaining_bytes = progress.bytes_total - progress.bytes_loaded
        const remaining_seconds = remaining_bytes / speed_bps

        return format_eta( remaining_seconds, t )
    }

    if( !model ) return null

    const percent = Math.round( progress.progress * 100 )
    const eta = get_eta()

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
                { eta && <span>{ eta }</span> }
            </ProgressDetails>
        </ProgressContainer>

        { /* Always render to reserve space and avoid layout shift */ }
        <ETAText>{ eta }</ETAText>

        <CancelButton onClick={ handle_cancel }>
            <X size={ 16 } />
            { t( 'cancel_download' ) }
        </CancelButton>

    </Container>

}
