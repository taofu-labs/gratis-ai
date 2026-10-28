import styled from 'styled-components'
import { BODY, LETTERS, OUTLINE } from './brand_paths'

const Svg = styled.svg`
    display: block;
    height: ${ ( { $height } ) => $height };
    width: auto;
    flex-shrink: 0;
    shape-rendering: crispEdges;
`

/**
 * Pixel "gratis" wordmark with its bunny. Letters follow the text colour;
 * the bunny stays an ink-outlined white sticker in both themes.
 * @param {Object} props
 * @param {string} [props.height] - CSS height, width follows
 * @param {string} [props.title] - Accessible name; decorative when omitted
 * @returns {JSX.Element}
 */
export default function BrandMark( { height = `1.75rem`, title } ) {

    const a11y = title ? { role: `img`, 'aria-label': title } : { 'aria-hidden': true }

    return <Svg viewBox="0 44 2214 680" $height={ height } { ...a11y }>
        <g transform="translate( 0 724 ) scale( .1 -.1 )">
            <path fill="#FFFFFF" d={ BODY } />
            <path fill="#131517" d={ OUTLINE } />
            <path fill="currentColor" d={ LETTERS } />
        </g>
    </Svg>

}
