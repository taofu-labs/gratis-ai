import { useEffect, useId, useRef } from 'react'
import styled, { keyframes } from 'styled-components'
import { Download, ShieldCheck, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Button from '../atoms/Button'
import SpeedGauge from '../atoms/SpeedGauge'
import { mode_text } from './SpeedModeMenu'
import { EVENTS } from '../../utils/branding'
import { format_file_size, format_tokens_per_second, model_download_bytes } from '../../utils/model_catalog'

const fade_in = keyframes`
    from { opacity: 0; }
    to { opacity: 1; }
`

const rise_in = keyframes`
    from { opacity: 0; transform: translateY( 8px ); }
    to { opacity: 1; transform: translateY( 0 ); }
`

const Overlay = styled.div`
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: ${ ( { theme } ) => theme.spacing.md };
    background: ${ ( { theme } ) => theme.colors.modal_overlay };
    animation: ${ fade_in } 0.5s cubic-bezier( .2, .8, .2, 1 );
    @media ( prefers-reduced-motion: reduce ) { animation: none; }
`

const Dialog = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${ ( { theme } ) => theme.spacing.md };
    width: min( 26rem, 100% );
    padding: ${ ( { theme } ) => theme.spacing.lg };
    background: ${ ( { theme } ) => theme.colors.background };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.lg };
    box-shadow: 0 4px 24px rgba( 0, 0, 0, ${ ( { theme } ) => theme.mode === `dark` ? 0.4 : 0.1 } );
    animation: ${ rise_in } 0.5s cubic-bezier( .2, .8, .2, 1 );
    @media ( prefers-reduced-motion: reduce ) { animation: none; }
`

const Header = styled.div`
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: ${ ( { theme } ) => theme.spacing.sm };
`

const Title = styled.h2`
    font-size: 1.1rem;
    font-weight: 600;
    line-height: 1.35;
`

const CloseButton = styled.button`
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 2.75rem;
    min-height: 2.75rem;
    margin: -0.625rem -0.625rem 0 0;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    &:hover { color: ${ ( { theme } ) => theme.colors.text }; }
`

const Facts = styled.ul`
    display: flex;
    flex-direction: column;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    font-size: 0.9rem;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
`

const Fact = styled.li`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    & svg { flex-shrink: 0; }
`

const Actions = styled.div`
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: ${ ( { theme } ) => theme.spacing.sm };
`

/**
 * A speed mode whose model is not on this device yet: what it is, what it
 * costs, and a download that hands over to the download page.
 *
 * @param {Object} props
 * @param {{ priority: string, model: Object, tokens_per_second: number }|null} props.mode - Null keeps it closed
 * @param {Function} props.on_confirm - Start the download
 * @param {Function} props.on_close
 * @returns {JSX.Element|null}
 */
export default function ModelDownloadDialog( { mode, on_confirm, on_close } ) {

    const { t } = useTranslation( `models` )
    const title_id = useId()
    const confirm_ref = useRef( null )
    const dialog_ref = useRef( null )

    // Escape (app-wide close event) and focus on the primary action
    useEffect( () => {

        if( !mode ) return
        const previous = document.activeElement
        confirm_ref.current?.focus()
        window.addEventListener( EVENTS.close_modal, on_close )
        return () => {
            window.removeEventListener( EVENTS.close_modal, on_close )
            previous?.focus?.()
        }

    }, [ mode, on_close ] )

    if( !mode ) return null

    // Focus trap: Tab and Shift+Tab cycle inside the dialog, never into the page behind it
    const trap_focus = e => {
        if( e.key !== `Tab` ) return
        const focusable = [ ...dialog_ref.current.querySelectorAll( `button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])` ) ]
        const [ first, last ] = [ focusable[ 0 ], focusable.at( -1 ) ]
        if( e.shiftKey && document.activeElement === first ) {
            e.preventDefault()
            last.focus()
        } else if( !e.shiftKey && document.activeElement === last ) {
            e.preventDefault()
            first.focus()
        }
    }

    const { label, speed } = mode_text( t, mode.priority )
    const size = format_file_size( model_download_bytes( mode.model ) )

    return <Overlay onClick={ e => e.target === e.currentTarget && on_close() }>
        <Dialog ref={ dialog_ref } role="dialog" aria-modal="true" aria-labelledby={ title_id } onKeyDown={ trap_focus } data-testid="mode-download-dialog">

            <Header>
                <Title id={ title_id }>{ t( `mode_download_title`, { mode: label } ) }</Title>
                <CloseButton type="button" onClick={ on_close } aria-label={ t( `common:aria_close_dialog` ) }>
                    <X size={ 18 } />
                </CloseButton>
            </Header>

            <Facts>
                <Fact>
                    <SpeedGauge mode={ mode.priority } size={ 18 } />
                    { mode.model.name } · { speed } · { format_tokens_per_second( mode.tokens_per_second ) }
                </Fact>
                <Fact><Download size={ 18 } />{ t( `mode_download_size`, { size } ) }</Fact>
                <Fact><ShieldCheck size={ 18 } />{ t( `mode_download_private` ) }</Fact>
            </Facts>

            <Actions>
                <Button type="button" $variant="secondary" onClick={ on_close }>{ t( `not_now` ) }</Button>
                <Button ref={ confirm_ref } type="button" $sheen data-testid="mode-download-confirm" onClick={ on_confirm }>
                    { t( `download_cta`, { size } ) }
                </Button>
            </Actions>

        </Dialog>
    </Overlay>

}
