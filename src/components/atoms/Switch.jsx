import styled from 'styled-components'

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
    border-radius: ${ ( { theme } ) => theme.border_radius.pill };
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
        background: #FFFFFF;
        box-shadow: 0 0 0 1px rgba( 19, 21, 23, 0.6 );
        transition: left 0.16s;
    }

    @media ( prefers-reduced-motion: reduce ) {
        transition: none;
        &::after { transition: none; }
    }
`

/**
 * On/off row: the whole row toggles and carries role="switch".
 * @param {Object} props
 * @param {boolean} props.on
 * @param {string} props.label
 * @param {Function} props.on_toggle
 * @returns {JSX.Element}
 */
export default function Switch( { on, label, on_toggle, ...props } ) {
    return <SwitchRow type="button" role="switch" aria-checked={ on } onClick={ on_toggle } { ...props }>
        { label }
        <Track $on={ on } aria-hidden="true" />
    </SwitchRow>
}
