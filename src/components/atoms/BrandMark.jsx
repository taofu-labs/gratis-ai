import styled from 'styled-components'

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
    return <Mark src="/icons/icon-512.png" alt="" aria-hidden="true" $size={ size } />
}
