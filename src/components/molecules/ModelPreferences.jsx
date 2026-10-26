import { useId } from 'react'
import styled from 'styled-components'
import { useTranslation } from 'react-i18next'
import SpeedGauge from '../atoms/SpeedGauge'

const GroupLabel = styled.p`
    font-size: 0.8rem;
    font-weight: 600;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    margin-bottom: ${ ( { theme } ) => theme.spacing.xs };
`

// Segmented control: one outline, the selected segment gets a quiet fill
const Segments = styled.div`
    display: flex;
    flex-wrap: wrap;
    border: 1px solid ${ ( { theme } ) => theme.colors.border_control };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    overflow: hidden;
`

const Segment = styled.button`
    flex: 1 1 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    min-height: 3.25rem;
    padding: 0 ${ ( { theme } ) => theme.spacing.sm };
    font-size: 0.85rem;
    color: ${ ( { theme, $active } ) => $active ? theme.colors.text : theme.colors.text_secondary };
    font-weight: ${ ( { $active } ) => $active ? 600 : 400 };
    background: ${ ( { theme, $active } ) => $active ? `${ theme.colors.accent }1f` : `transparent` };
    box-shadow: ${ ( { theme, $active } ) => $active ? `inset 0 -2px 0 ${ theme.colors.accent }` : `none` };
    transition: background-color 0.16s, color 0.16s;

    & + & { border-left: 1px solid ${ ( { theme } ) => theme.colors.border_control }; }
    &:hover { background: ${ ( { theme, $active } ) => $active ? `${ theme.colors.accent }29` : theme.colors.surface_hover }; }
`

const SegmentText = styled.span`
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1.25;
`

// The speed in words, under the mode name: Slow / Medium / Fast
const SegmentSpeed = styled.span`
    font-size: 0.72rem;
    font-weight: 400;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

// Whole row toggles; the track is decoration, the row carries role="switch"
const SwitchRow = styled.button`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${ ( { theme } ) => theme.spacing.md };
    width: 100%;
    min-height: 2.75rem;
    text-align: left;
    font-size: 0.9rem;
    color: ${ ( { theme } ) => theme.colors.text };
`

const Track = styled.span`
    position: relative;
    flex-shrink: 0;
    width: 2.25rem;
    height: 1.25rem;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    background: ${ ( { theme, $on } ) => $on ? theme.colors.accent : theme.colors.border_strong };
    transition: background-color 0.16s;

    &::after {
        content: '';
        position: absolute;
        top: 0.125rem;
        left: ${ ( { $on } ) => $on ? `1.125rem` : `0.125rem` };
        width: 1rem;
        height: 1rem;
        border-radius: 50%;
        background: ${ ( { theme } ) => theme.colors.text };
        transition: left 0.16s;
    }

    @media ( prefers-reduced-motion: reduce ) {
        transition: none;
        &::after { transition: none; }
    }
`

const Note = styled.p`
    font-size: 0.8rem;
    line-height: 1.45;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

const Toggles = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${ ( { theme } ) => theme.spacing.xs };
`

export function Switch( { on, label, on_toggle, ...props } ) {
    return <SwitchRow type="button" role="switch" aria-checked={ on } onClick={ on_toggle } { ...props }>
        { label }
        <Track $on={ on } aria-hidden="true" />
    </SwitchRow>
}

/**
 * The two choices that change which model fits: photo understanding and an
 * uncensored model, whose honest note shows while it is on. Changes apply live.
 *
 * @param {Object} props
 * @param {import('../../utils/model_catalog').PickerPreferences} props.preferences
 * @param {Function} props.on_change - Receives a partial preferences patch
 */
export function ModelToggles( { preferences, on_change } ) {

    const { t } = useTranslation( `models` )

    return <Toggles data-testid="model-toggles">

        <Switch
            data-testid="need-photos-switch"
            on={ preferences.vision }
            label={ t( `need_photos` ) }
            on_toggle={ () => on_change( { vision: !preferences.vision } ) }
        />

        <Switch
            data-testid="fewer-refusals-switch"
            on={ preferences.fewer_refusals }
            label={ t( `fewer_refusals` ) }
            on_toggle={ () => on_change( { fewer_refusals: !preferences.fewer_refusals } ) }
        />
        { preferences.fewer_refusals && <Note>{ t( `fewer_refusals_note` ) }</Note> }

    </Toggles>

}

/**
 * Reply speed as three gauges, slow → fast: Smarter, Balanced, Faster. Each
 * names its speed in words, so the needle is never the only signal. Modes this
 * device can't tell apart are left out. Changes apply live.
 *
 * @param {Object} props
 * @param {string} props.active - Highlighted mode
 * @param {string[]} props.available - Priorities with a distinct model here, slow → fast
 * @param {Function} props.on_change - Receives a partial preferences patch
 */
export default function SpeedModePicker( { active: active_mode, available, on_change } ) {

    const { t } = useTranslation( `models` )
    const label_id = useId()

    if( available.length < 2 ) return null

    // Radio group keys: one Tab stop, arrows move (and apply) the selection
    const handle_key = e => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ e.key ]
        if( !step ) return
        e.preventDefault()
        const index = Math.max( 0, available.indexOf( active_mode ) )
        const next = available[ ( index + step + available.length ) % available.length ]
        on_change( { priority: next } )
        e.currentTarget.querySelector( `[data-priority="${ next }"]` )?.focus()
    }

    return <div data-testid="speed-mode-picker">

        <GroupLabel id={ label_id }>{ t( `speed_mode_title` ) }</GroupLabel>

        <Segments role="radiogroup" aria-labelledby={ label_id } onKeyDown={ handle_key }>
            { available.map( priority => {
                const active = active_mode === priority
                return <Segment
                    key={ priority }
                    type="button"
                    role="radio"
                    aria-checked={ active }
                    tabIndex={ active || !available.includes( active_mode ) && priority === available[ 0 ] ? 0 : -1 }
                    $active={ active }
                    data-priority={ priority }
                    data-testid={ `priority-${ priority }` }
                    onClick={ () => on_change( { priority } ) }
                >
                    <SpeedGauge mode={ priority } size={ 20 } colored={ active } />
                    <SegmentText>
                        { t( `mode_${ priority }` ) }
                        <SegmentSpeed>{ t( `mode_${ priority }_speed` ) }</SegmentSpeed>
                    </SegmentText>
                </Segment>
            } ) }
        </Segments>

    </div>

}
