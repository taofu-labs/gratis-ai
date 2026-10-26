import styled, { useTheme } from 'styled-components'

// Needle angle per mode: left = slow (smarter), up = medium, right = fast
const NEEDLE_ANGLE = { better: -60, balanced: 0, faster: 60 }

const Needle = styled.line`
    transition: transform 0.2s cubic-bezier( .2, .8, .2, 1 );
    transform-origin: 12px 15px;
    @media ( prefers-reduced-motion: reduce ) { transition: none; }
`

/**
 * Color that backs up the needle (never the only signal): muted for the
 * balanced default, accent for smarter, cool info blue for faster.
 * @param {Object} theme
 * @param {'better'|'balanced'|'faster'|null} mode
 * @returns {string}
 */
export const gauge_color = ( theme, mode ) => ( {
    better: theme.colors.accent,
    faster: theme.colors.info,
} )[ mode ] || theme.colors.text_secondary

/**
 * Speedometer icon whose needle shows the reply speed of a mode:
 * left for Smarter (slow), centre for Balanced, right for Faster.
 * A null mode (a model outside the modes) parks the needle at centre, muted.
 *
 * @param {Object} props
 * @param {'better'|'balanced'|'faster'|null} props.mode
 * @param {number} [props.size] - Pixels
 * @param {boolean} [props.colored] - Tint by mode; off for neutral contexts
 * @returns {JSX.Element}
 */
export default function SpeedGauge( { mode, size = 16, colored = true, ...props } ) {

    const theme = useTheme()
    const color = colored ? gauge_color( theme, mode ) : `currentColor`

    return <svg
        width={ size }
        height={ size }
        viewBox="0 0 24 24"
        fill="none"
        stroke={ color }
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        { ...props }
    >
        { /* Dial: an open arc with a tick at the slow and fast ends */ }
        <path d="M4.2 19.5a9.5 9.5 0 1 1 15.6 0" />
        <path d="M5.6 12.4 7 13" />
        <path d="M18.4 12.4 17 13" />
        <Needle x1="12" y1="15" x2="12" y2="7.5" style={ { transform: `rotate( ${ NEEDLE_ANGLE[ mode ] ?? 0 }deg )` } } />
        <circle cx="12" cy="15" r="1.4" fill={ color } />
    </svg>

}
