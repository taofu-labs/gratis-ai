import { useEffect } from 'react'
import styled from 'styled-components'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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
    text-align: center;
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

const Title = styled.h2`
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: ${ ( { theme } ) => theme.spacing.sm };
`

const Description = styled.p`
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    font-size: 0.9rem;
    line-height: 1.5;
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
`

const CancelButton = styled( Button )`
    background: ${ ( { theme } ) => theme.colors.input_background };
    color: ${ ( { theme } ) => theme.colors.text };
`

const RestartButton = styled( Button )`
    background: ${ ( { theme } ) => theme.colors.accent };
    color: ${ ( { theme } ) => theme.colors.accent_ink };
`

/**
 * Modal shown when an update has been downloaded and is ready to install.
 * Prompts the user to quit and reopen or dismiss.
 *
 * @param {Object} props
 * @param {Object|null} props.available_update - { version, release_notes }
 * @param {boolean} props.is_ready_to_install
 * @param {boolean} props.dismissed
 * @param {Function} props.on_install - Quits and installs the update
 * @param {Function} props.on_dismiss - Closes the modal
 */
export default function UpdateModal( {
    available_update, is_ready_to_install, dismissed,
    on_install, on_dismiss,
} ) {

    const { t } = useTranslation( `pages` )

    // Close on Escape key
    useEffect( () => {

        if( !is_ready_to_install || dismissed ) return

        const handle_key = ( e ) => {
            if( e.key === `Escape` ) on_dismiss()
        }

        window.addEventListener( `keydown`, handle_key )
        return () => window.removeEventListener( `keydown`, handle_key )

    }, [ is_ready_to_install, dismissed, on_dismiss ] )

    // Only visible when download is complete and not dismissed
    if( !available_update || !is_ready_to_install || dismissed ) return null

    const { version } = available_update

    return <Overlay onClick={ on_dismiss }>
        <Modal onClick={ e => e.stopPropagation() }>

            <IconContainer>
                <RefreshCw size={ 24 } />
            </IconContainer>

            <Title>{ t( `update_ready_title` ) }</Title>
            <Description>{ t( `update_ready_description`, { version } ) }</Description>

            <ButtonRow>
                <CancelButton onClick={ on_dismiss }>
                    { t( `common:cancel` ) }
                </CancelButton>
                <RestartButton onClick={ on_install }>
                    { t( `update_quit_and_reopen` ) }
                </RestartButton>
            </ButtonRow>

        </Modal>
    </Overlay>

}
