import { useEffect } from 'react'
import styled, { keyframes } from 'styled-components'
import { Mic, X, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EVENTS } from '../../utils/branding'

const Overlay = styled.div`
    position: fixed;
    inset: 0;
    background: ${ ( { theme } ) => theme.colors.modal_overlay };
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
`

const Modal = styled.div`
    background: ${ ( { theme } ) => theme.colors.background };
    border-radius: ${ ( { theme } ) => theme.border_radius.lg };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    box-shadow: ${ ( { theme } ) => theme.mode === `dark`
        ? `0 4px 24px rgba( 0, 0, 0, 0.4 )`
        : `0 4px 24px rgba( 0, 0, 0, 0.1 )` };
    width: min( 420px, 90vw );
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: ${ ( { theme } ) => theme.spacing.lg };
`

const Header = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: ${ ( { theme } ) => theme.spacing.md };
`

const Title = styled.h2`
    font-size: 1.1rem;
    font-weight: 600;
`

const CloseButton = styled.button`
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 2.75rem;
    min-height: 2.75rem;
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    color: ${ ( { theme } ) => theme.colors.text_muted };
    transition: color 0.15s;

    &:hover { color: ${ ( { theme } ) => theme.colors.text }; }
`

const IconContainer = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3.5rem;
    height: 3.5rem;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    background: ${ ( { theme } ) => theme.colors.input_background };
    color: ${ ( { theme } ) => theme.colors.accent };
    margin: 0 auto ${ ( { theme } ) => theme.spacing.md };
`

const Description = styled.p`
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    font-size: 0.9rem;
    line-height: 1.5;
    text-align: center;
    margin-bottom: ${ ( { theme } ) => theme.spacing.md };
`

const SizeBadge = styled.span`
    display: inline-block;
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } ${ theme.spacing.sm }` };
    background: ${ ( { theme } ) => theme.colors.input_background };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    font-weight: 500;
`

const SizeBadgeRow = styled.div`
    display: flex;
    justify-content: center;
    margin-bottom: ${ ( { theme } ) => theme.spacing.lg };
`

const ButtonRow = styled.div`
    display: flex;
    gap: ${ ( { theme } ) => theme.spacing.sm };
`

const Button = styled.button`
    flex: 1;
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.md }` };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    font-size: 0.9rem;
    font-weight: 500;
    transition: opacity 0.15s;

    &:hover { opacity: 0.8; }

    &:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
`

const CancelButton = styled( Button )`
    background: ${ ( { theme } ) => theme.colors.input_background };
    color: ${ ( { theme } ) => theme.colors.text };
`

const ConfirmButton = styled( Button )`
    background: ${ ( { theme } ) => theme.colors.accent };
    color: ${ ( { theme } ) => theme.colors.accent_ink };
`

// Progress bar components
const ProgressContainer = styled.div`
    margin-bottom: ${ ( { theme } ) => theme.spacing.md };
`

const ProgressBarTrack = styled.div`
    width: 100%;
    height: 0.5rem;
    background: ${ ( { theme } ) => theme.colors.input_background };
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    overflow: hidden;
    margin-bottom: ${ ( { theme } ) => theme.spacing.sm };
`

const ProgressBarFill = styled.div`
    height: 100%;
    background: ${ ( { theme } ) => theme.colors.accent };
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    transition: width 0.3s ease-out;
    width: ${ ( { $progress } ) => `${ $progress * 100 }%` };
`

const ProgressText = styled.div`
    display: flex;
    justify-content: space-between;
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

// Error state components
const ErrorContainer = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    margin-bottom: ${ ( { theme } ) => theme.spacing.md };
    color: ${ ( { theme } ) => theme.colors.error };
`

const ErrorText = styled.p`
    color: ${ ( { theme } ) => theme.colors.error };
    font-size: 0.85rem;
    text-align: center;
`

const pulse_glow = keyframes`
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
`

const LoadingDot = styled.div`
    display: inline-block;
    animation: ${ pulse_glow } 1.5s ease-in-out infinite;
`

/**
 * Two-state dialog for confirming ASR model download and showing progress.
 * Follows the existing modal pattern from SettingsModal.
 *
 * @param {Object} props
 * @param {boolean} props.is_open - Whether the dialog is visible
 * @param {Function} props.on_close - Close the dialog
 * @param {Function} props.on_confirm - User confirmed the download
 * @param {boolean} props.is_downloading - Download in progress
 * @param {{ progress: number, status: string }} props.download_progress - Progress info
 * @param {boolean} [props.has_error] - Whether the download failed
 * @param {Function} [props.on_retry] - Retry after failure
 * @returns {JSX.Element|null}
 */
export default function VoiceModelDialog( {
    is_open,
    on_close,
    on_confirm,
    is_downloading,
    download_progress,
    has_error = false,
    on_retry,
} ) {

    const { t } = useTranslation( `pages` )

    // Close on Escape key
    useEffect( () => {

        const handle_close = () => {
            if( is_open && !is_downloading ) on_close()
        }
        window.addEventListener( EVENTS.close_modal, handle_close )
        return () => window.removeEventListener( EVENTS.close_modal, handle_close )

    }, [ is_open, is_downloading, on_close ] )

    if( !is_open ) return null

    // Close on backdrop click (only when not downloading)
    const handle_overlay_click = ( e ) => {
        if( e.target === e.currentTarget && !is_downloading ) on_close()
    }

    const progress_percent = Math.round( ( download_progress?.progress || 0 ) * 100 )

    return <Overlay onClick={ handle_overlay_click }>
        <Modal>

            <Header>
                <Title>{ is_downloading ? t( `downloading_model` ) : t( `voice_input` ) }</Title>
                { !is_downloading && <CloseButton onClick={ on_close } aria-label={ t( `common:aria_close_dialog` ) }>
                    <X size={ 18 } />
                </CloseButton> }
            </Header>

            { /* Icon */ }
            <IconContainer>
                <Mic size={ 24 } />
            </IconContainer>

            { /* Error state */ }
            { has_error && <ErrorContainer>
                <AlertCircle size={ 20 } />
                <ErrorText>{ t( `voice_download_failed` ) }</ErrorText>
                <ButtonRow>
                    <CancelButton onClick={ on_close }>{ t( `common:cancel` ) }</CancelButton>
                    <ConfirmButton onClick={ on_retry }>{ t( `common:retry` ) }</ConfirmButton>
                </ButtonRow>
            </ErrorContainer> }

            { /* Download progress state */ }
            { is_downloading && !has_error && <>
                <ProgressContainer>
                    <ProgressBarTrack>
                        <ProgressBarFill $progress={ download_progress?.progress || 0 } />
                    </ProgressBarTrack>
                    <ProgressText>
                        <span>
                            <LoadingDot>{ download_progress?.status || t( `voice_downloading` ) }</LoadingDot>
                        </span>
                        <span>{ progress_percent }%</span>
                    </ProgressText>
                </ProgressContainer>

                <ButtonRow>
                    <CancelButton onClick={ on_close }>{ t( `common:hide` ) }</CancelButton>
                </ButtonRow>
            </> }

            { /* Confirmation state */ }
            { !is_downloading && !has_error && <>
                <Description>
                    { t( `voice_description` ) }
                </Description>

                <SizeBadgeRow>
                    <SizeBadge>{ t( `voice_size_badge` ) }</SizeBadge>
                </SizeBadgeRow>

                <ButtonRow>
                    <CancelButton onClick={ on_close }>{ t( `common:cancel` ) }</CancelButton>
                    <ConfirmButton onClick={ on_confirm }>{ t( `common:download` ) }</ConfirmButton>
                </ButtonRow>
            </> }

        </Modal>
    </Overlay>

}
