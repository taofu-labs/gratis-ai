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
 * arriving (TTFT gap). Says "Waiting for the model" while it loads, then
 * that the model reads the message, with a percentage once llama.cpp reports
 * one. Progress only arrives between prompt batches, so a short message is
 * read before any number shows.
 */
export default function ReadingIndicator() {

    const { t } = useTranslation( `chat` )
    const is_loading = use_llm_store( s => s.is_loading )
    const percent = use_llm_store( s => prompt_percent( s.prompt_progress ) )

    const label = is_loading ? t( `waiting_for_model` )
        : percent !== null ? t( `reading_message`, { percent } )
            : t( `reading` )

    return <Wrapper data-testid="reading-indicator">

        <Indicator>
            { label }
            <Dot $delay={ 0 } />
            <Dot $delay={ 0.2 } />
            <Dot $delay={ 0.4 } />
        </Indicator>

    </Wrapper>

}
