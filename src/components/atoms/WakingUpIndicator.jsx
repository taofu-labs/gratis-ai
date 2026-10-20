import styled, { keyframes } from 'styled-components'
import { useTranslation } from 'react-i18next'
import use_llm_store from '../../stores/llm_store'

/**
 * Share of the uncached prompt llama.cpp has read, or null before it reports.
 * @param {{ total: number, cache: number, processed: number }|null} progress
 * @returns {number|null} Whole percent, 0–99
 */
export const prompt_percent = progress => {
    if( !progress?.total ) return null
    const uncached = progress.total - ( progress.cache || 0 )
    if( uncached <= 0 ) return null
    const read = progress.processed - ( progress.cache || 0 )
    // Hold at 99 % until the first token: sampling still follows the last batch
    return Math.min( 99, Math.max( 0, Math.floor( read / uncached * 100 ) ) )
}


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
 * Animated indicator shown between pressing send and the first token
 * arriving (TTFT gap). Says "Loading" while the model loads, then how much
 * of the prompt the model has read once llama.cpp reports progress.
 *
 * @param {Object} [props]
 * @param {boolean} [props.show_hint] - Show cold-start explanation below the indicator
 */
export default function WakingUpIndicator( { show_hint = false } = {} ) {

    const { t } = useTranslation( `chat` )
    const is_loading = use_llm_store( s => s.is_loading )
    const percent = use_llm_store( s => prompt_percent( s.prompt_progress ) )

    const label = is_loading ? t( `waiting_for_model` )
        : percent !== null ? t( `reading_message`, { percent } )
            : t( `waking_up` )

    return <Wrapper data-testid="waking-up-indicator">

        <Indicator>
            { label }
            <Dot $delay={ 0 } />
            <Dot $delay={ 0.2 } />
            <Dot $delay={ 0.4 } />
        </Indicator>

        { show_hint && <Hint>{ t( `waking_up_hint` ) }</Hint> }

    </Wrapper>

}
