import { useId } from 'react'
import styled from 'styled-components'
import { useTranslation } from 'react-i18next'

const Panel = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${ ( { theme } ) => theme.spacing.md };
    padding-top: ${ ( { theme } ) => theme.spacing.md };
    border-top: 1px solid ${ ( { theme } ) => theme.colors.border };
`

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
    flex: 1 1 auto;
    min-height: 2.75rem;
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

const PRIORITIES = [
    { key: `faster`, label: `priority_faster` },
    { key: `balanced`, label: `priority_balanced` },
    { key: `better`, label: `priority_better` },
]

function Switch( { on, label, on_toggle, ...props } ) {
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
 * Optional tailoring: reply speed vs quality. Changes apply live.
 *
 * @param {Object} props
 * @param {import('../../utils/model_catalog').PickerPreferences} props.preferences
 * @param {Function} props.on_change - Receives a partial preferences patch
 */
export default function ModelPreferences( { preferences, on_change } ) {

    const { t } = useTranslation( `models` )
    const replies_label_id = useId()

    return <Panel data-testid="model-preferences">

        <div>
            <GroupLabel id={ replies_label_id }>{ t( `replies_label` ) }</GroupLabel>
            <Segments role="radiogroup" aria-labelledby={ replies_label_id }>
                { PRIORITIES.map( ( { key, label } ) => <Segment
                    key={ key }
                    type="button"
                    role="radio"
                    aria-checked={ preferences.priority === key }
                    $active={ preferences.priority === key }
                    data-testid={ `priority-${ key }` }
                    onClick={ () => on_change( { priority: key } ) }
                >
                    { t( label ) }
                </Segment> ) }
            </Segments>
        </div>

    </Panel>

}
