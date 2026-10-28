import { useEffect, useId, useRef, useState } from 'react'
import styled from 'styled-components'
import { Check, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import SpeedGauge from '../atoms/SpeedGauge'
import { format_file_size, format_tokens_per_second, model_download_bytes } from '../../utils/model_catalog'

// Not positioned: the menu anchors to the composer (ChatInput's pill), so it
// right-aligns with the composer and never runs off a phone screen
const Anchor = styled.div`
    flex-shrink: 0;
`

// Pill, not a circle: the gauge carries a label so the mode never relies on the icon alone
const Trigger = styled.button`
    display: flex;
    align-items: center;
    gap: 0.375rem;
    height: 2rem;
    padding: 0 0.75rem 0 0.5rem;
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
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

    @media ${ ( { theme } ) => theme.media.touch } {
        height: 2.75rem;
        padding-block: 0.375rem;
        background-clip: content-box;
    }

    /* Narrow phones: a 32px circle like its neighbours (44px hit area); the needle
       and the menu speak, a label would squeeze the text field */
    @media ( max-width: 480px ) {
        justify-content: center;
        width: 2.75rem;
        padding: 0.375rem;
        & > span { display: none; }
    }
`

const Menu = styled.div`
    position: absolute;
    bottom: calc( 100% + 0.5rem );
    right: 0;
    max-width: 100%;
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
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
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
    const trigger_ref = useRef( null )
    const menu_ref = useRef( null )
    const menu_id = useId()

    // A reply or model load starting locks the menu too, not only the trigger
    const is_open = open && !disabled

    // Keyboard users land on the current mode (or the first) when it opens
    useEffect( () => {
        if( !is_open ) return
        const rows = [ ...menu_ref.current.querySelectorAll( `[role="menuitemradio"]` ) ]
        ;( rows.find( row => row.getAttribute( `aria-checked` ) === `true` ) || rows[ 0 ] )?.focus()
    }, [ is_open ] )

    // Outside tap closes without changing anything
    useEffect( () => {
        if( !is_open ) return
        const handle_pointer = e => !anchor_ref.current?.contains( e.target ) && set_open( false )
        document.addEventListener( `pointerdown`, handle_pointer )
        return () => document.removeEventListener( `pointerdown`, handle_pointer )
    }, [ is_open ] )

    // A single mode is no choice at all
    if( modes.length < 2 ) return null

    const current = active ? mode_text( t, active ) : null
    const trigger_label = current ? `${ current.label } · ${ current.speed }` : t( `mode_custom` )

    // Closing hands focus back to the gauge, so keyboard users keep their place
    const close = () => {
        set_open( false )
        trigger_ref.current?.focus()
    }

    const choose = mode => {
        close()
        if( !disabled && mode.priority !== active ) on_choose( mode )
    }

    // Arrow keys move between rows, Home / End jump, Escape closes
    const handle_menu_key = e => {
        const rows = [ ...menu_ref.current.querySelectorAll( `[role="menuitemradio"]` ) ]
        const index = rows.indexOf( document.activeElement )
        const target = {
            ArrowDown: rows[ ( index + 1 ) % rows.length ],
            ArrowUp: rows[ ( index - 1 + rows.length ) % rows.length ],
            Home: rows[ 0 ],
            End: rows.at( -1 ),
        }[ e.key ]
        if( e.key === `Escape` ) {
            e.stopPropagation()
            close()
        }
        if( !target ) return
        e.preventDefault()
        target.focus()
    }

    return <Anchor ref={ anchor_ref }>

        <Trigger
            ref={ trigger_ref }
            type="button"
            data-testid="speed-mode-btn"
            data-mode={ active || `custom` }
            aria-haspopup="menu"
            aria-expanded={ is_open }
            aria-controls={ is_open ? menu_id : undefined }
            aria-label={ t( `speed_mode_aria`, { mode: trigger_label } ) }
            title={ trigger_label }
            disabled={ disabled }
            onClick={ () => set_open( !open ) }
        >
            <SpeedGauge mode={ active } />
            <span>{ current ? current.label : t( `mode_custom` ) }</span>
        </Trigger>

        { is_open && <Menu ref={ menu_ref } id={ menu_id } role="menu" aria-label={ t( `speed_mode_title` ) } onKeyDown={ handle_menu_key } data-testid="speed-mode-menu">

            <MenuTitle>{ t( `speed_mode_title` ) }</MenuTitle>

            { modes.map( mode => {

                const { label, speed } = mode_text( t, mode.priority )
                const checked = mode.priority === active

                return <Row
                    key={ mode.priority }
                    type="button"
                    role="menuitemradio"
                    aria-checked={ checked }
                    tabIndex={ -1 }
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
