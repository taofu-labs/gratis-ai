import { css } from 'styled-components'

/**
 * Column that centers its content when it fits and scrolls from the top when it doesn't
 * (the touch keyboard can leave little room). Flex spacers, not `justify-content: safe center`:
 * iOS Safari before 17.6 centers overflow unsafely, pushing the top out of reach.
 */
export const scroll_center = css`
    justify-content: flex-start;
    min-height: 0;
    overflow-y: auto;

    &::before, &::after {
        content: '';
        flex: 1 0 0px;
    }
`
