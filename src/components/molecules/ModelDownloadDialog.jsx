import { useRef } from 'react'
import { createPortal } from 'react-dom'
import styled, { keyframes } from 'styled-components'
import { Download, ShieldCheck, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Button from '../atoms/Button'
import SpeedGauge from '../atoms/SpeedGauge'
import { mode_text } from './SpeedModeMenu'
import use_dialog from '../../hooks/use_dialog'
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
    const confirm_ref = useRef( null )

    // Dialog semantics, focus trap, Escape + backdrop close; focus lands on the primary action
    const { title_id, overlay_props, dialog_props } = use_dialog( { is_open: !!mode, on_close, initial_focus: confirm_ref } )

    if( !mode ) return null

    const { label, speed } = mode_text( t, mode.priority )
    const size = format_file_size( model_download_bytes( mode.model ) )

    // Portal out of #root — the app behind is made inert while open
    return createPortal( <Overlay { ...overlay_props }>
        <Dialog { ...dialog_props } data-testid="mode-download-dialog">

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
    </Overlay>, document.body )

}
