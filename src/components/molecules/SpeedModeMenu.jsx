import { useEffect, useId, useRef, useState } from 'react'
import styled from 'styled-components'
import { Check, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import SpeedGauge from '../atoms/SpeedGauge'
import { format_file_size, format_tokens_per_second, model_download_bytes } from '../../utils/model_catalog'

const Anchor = styled.div`
    position: relative;
    flex-shrink: 0;
`

// Pill, not a circle: the gauge carries a label so the mode never relies on the icon alone
const Trigger = styled.button`
    display: flex;
    align-items: center;
    gap: 0.375rem;
    height: 2rem;
    padding: 0 0.75rem 0 0.5rem;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    background-color: ${ ( { theme } ) => theme.colors.surface_hover };
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    font-size: 0.8rem;
    font-weight: 500;
    white-space: nowrap;
    transition: color 0.15s, background 0.15s, opacity 0.15s;

    &:hover:not( :disabled ) {
        color: ${ ( { theme } ) => theme.colors.text };
        background-color: ${ ( { theme } ) => theme.colors.border_subtle };
    }

    &:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    /* Narrow phones: the needle and the menu speak; the label would squeeze the text field */
    @media ( max-width: 480px ) {
        padding: 0 0.5rem;
        & > span { display: none; }
    }

    @media ${ ( { theme } ) => theme.media.touch } {
        height: 2.75rem;
        padding-block: 0.375rem;
        background-clip: content-box;
    }
`

const Menu = styled.div`
    position: absolute;
    bottom: calc( 100% + 0.5rem );
    right: 0;
    z-index: 50;
    width: min( 20rem, calc( 100vw - 2rem ) );
    padding: ${ ( { theme } ) => theme.spacing.xs };
    background: ${ ( { theme } ) => theme.colors.background };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.lg };
    box-shadow: 0 8px 24px rgba( 0, 0, 0, ${ ( { theme } ) => theme.mode === `dark` ? 0.4 : 0.12 } );
`

const MenuTitle = styled.p`
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } ${ theme.spacing.sm }` };
    font-size: 0.75rem;
    font-weight: 600;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

const Row = styled.button`
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    width: 100%;
    min-height: 2.75rem;
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } ${ theme.spacing.sm }` };
    text-align: left;
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    color: ${ ( { theme } ) => theme.colors.text };
    transition: background 0.15s;

    &:hover, &:focus-visible { background: ${ ( { theme } ) => theme.colors.surface_hover }; }
`

const RowText = styled.span`
    display: flex;
    flex-direction: column;
    min-width: 0;
`

const RowTitle = styled.span`
    font-size: 0.875rem;
    font-weight: 500;
`

const RowMeta = styled.span`
    font-size: 0.75rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

// Speed word as a small tinted pill: Slow / Medium / Fast, always in text
const SpeedPill = styled.span`
    padding: 0.0625rem 0.4375rem;
    margin-left: 0.375rem;
    font-size: 0.7rem;
    font-weight: 500;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    background: ${ ( { theme } ) => theme.colors.surface_hover };
    color: ${ ( { theme } ) => theme.colors.text_secondary };
`

const Trailing = styled.span`
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

/**
 * One mode's label and speed word, shared with the picker so both read the same
 * @param {Function} t - `models` namespace
 * @param {'better'|'balanced'|'faster'} priority
 */
export const mode_text = ( t, priority ) => ( {
    label: t( `mode_${ priority }` ),
    speed: t( `mode_${ priority }_speed` ),
} )

/**
 * Composer control: a speed gauge plus the mode name. Opens a menu of the
 * modes this device offers, slow → fast, each with its model, estimated
 * speed, and a download size when it is not on the device yet.
 *
 * @param {Object} props
 * @param {{ priority: string, model: Object, cached: boolean, tokens_per_second: number }[]} props.modes
 * @param {string|null} props.active - Mode whose model is loaded; null for any other model
 * @param {Function} props.on_choose - Receives the chosen mode
 * @param {boolean} [props.disabled] - While a reply is generating or a model is loading
 * @returns {JSX.Element|null}
 */
export default function SpeedModeMenu( { modes, active, on_choose, disabled } ) {

    const { t } = useTranslation( `models` )
    const [ open, set_open ] = useState( false )
    const anchor_ref = useRef( null )
    const menu_id = useId()

    // Outside tap and Escape close without changing anything
    useEffect( () => {

        if( !open ) return
        const handle_pointer = e => !anchor_ref.current?.contains( e.target ) && set_open( false )
        const handle_key = e => e.key === `Escape` && set_open( false )
        document.addEventListener( `pointerdown`, handle_pointer )
        document.addEventListener( `keydown`, handle_key )
        return () => {
            document.removeEventListener( `pointerdown`, handle_pointer )
            document.removeEventListener( `keydown`, handle_key )
        }

    }, [ open ] )

    // A single mode is no choice at all
    if( modes.length < 2 ) return null

    const current = active ? mode_text( t, active ) : null
    const trigger_label = current ? `${ current.label } · ${ current.speed }` : t( `mode_custom` )

    const choose = mode => {
        set_open( false )
        if( mode.priority !== active ) on_choose( mode )
    }

    return <Anchor ref={ anchor_ref }>

        <Trigger
            type="button"
            data-testid="speed-mode-btn"
            data-mode={ active || `custom` }
            aria-haspopup="menu"
            aria-expanded={ open }
            aria-controls={ open ? menu_id : undefined }
            aria-label={ t( `speed_mode_aria`, { mode: trigger_label } ) }
            title={ trigger_label }
            disabled={ disabled }
            onClick={ () => set_open( !open ) }
        >
            <SpeedGauge mode={ active } />
            <span>{ current ? current.label : t( `mode_custom` ) }</span>
        </Trigger>

        { open && <Menu id={ menu_id } role="menu" data-testid="speed-mode-menu">

            <MenuTitle>{ t( `speed_mode_title` ) }</MenuTitle>

            { modes.map( mode => {

                const { label, speed } = mode_text( t, mode.priority )
                const checked = mode.priority === active

                return <Row
                    key={ mode.priority }
                    type="button"
                    role="menuitemradio"
                    aria-checked={ checked }
                    data-testid={ `speed-mode-${ mode.priority }` }
                    onClick={ () => choose( mode ) }
                >
                    <SpeedGauge mode={ mode.priority } size={ 20 } />
                    <RowText>
                        <RowTitle>{ label }<SpeedPill>{ speed }</SpeedPill></RowTitle>
                        <RowMeta>{ mode.model.name } · { format_tokens_per_second( mode.tokens_per_second ) }</RowMeta>
                    </RowText>
                    <Trailing>
                        { checked && <Check size={ 16 } aria-label={ t( `mode_current` ) } /> }
                        { !checked && !mode.cached && <>
                            <Download size={ 14 } aria-hidden="true" />
                            { format_file_size( model_download_bytes( mode.model ) ) }
                        </> }
                    </Trailing>
                </Row>

            } ) }

        </Menu> }

    </Anchor>

}
