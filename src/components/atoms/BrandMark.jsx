import styled from 'styled-components'
import tpn_mark from '../../../public/icons/tpn-logo-mark.png'

const Mark = styled.img`
    display: block;
    width: ${ ( { $size } ) => $size };
    height: ${ ( { $size } ) => $size };
    object-fit: contain;
`

/**
 * True Performance Network logo mark.
 * @param {Object} props
 * @param {string} [props.size]
 * @returns {JSX.Element}
 */
export default function BrandMark( { size = `2.875rem` } ) {
    return <Mark src={ tpn_mark } alt="" aria-hidden="true" $size={ size } />
}
