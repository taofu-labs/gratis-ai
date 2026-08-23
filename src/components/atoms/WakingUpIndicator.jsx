import styled, { keyframes } from 'styled-components'
import { useTranslation } from 'react-i18next'


const pulse = keyframes`
    0%, 80%, 100% { opacity: 0.3; }
    40% { opacity: 1; }
`

const Wrapper = styled.div`
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
`

const Indicator = styled.span`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.82rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

const Hint = styled.span`
    font-size: 0.72rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    opacity: 0.7;
`

const Dot = styled.span`
    display: inline-block;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: ${ ( { theme } ) => theme.colors.text_muted };
    animation: ${ pulse } 1.4s ease-in-out infinite;
    animation-delay: ${ ( { $delay } ) => $delay }s;
`


/**
 * Animated "Waking up the AI" indicator shown between
 * pressing send and the first token arriving (TTFT gap).
 *
 * @param {Object} [props]
 * @param {boolean} [props.show_hint] - Show cold-start explanation below the indicator
 */
export default function WakingUpIndicator( { show_hint = false } = {} ) {

    const { t } = useTranslation( `chat` )

    return <Wrapper data-testid="waking-up-indicator">

        <Indicator>
            { t( `waking_up` ) }
            <Dot $delay={ 0 } />
            <Dot $delay={ 0.2 } />
            <Dot $delay={ 0.4 } />
        </Indicator>

        { show_hint && <Hint>{ t( `waking_up_hint` ) }</Hint> }

    </Wrapper>

}
