import styled from 'styled-components'
import { useTranslation } from 'react-i18next'
import use_model_load_status from '../../hooks/use_model_load_status'

const StageText = styled.p`
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    font-variant-numeric: tabular-nums;
    min-height: 1.3em;
    margin: 0;
`

/**
 * Current model-load stage with elapsed seconds, e.g. "Loading weights into memory · 12 s".
 * Renders an empty, space-reserving line while no load is in flight.
 * @returns {JSX.Element}
 */
export default function ModelLoadStage( props ) {

    const { t } = useTranslation( `pages` )
    const { is_loading, stage_key, elapsed_seconds } = use_model_load_status()

    const is_visible = is_loading && stage_key

    // Only the stage is announced; the ticking seconds would spam screen readers
    return <StageText data-testid="model-load-stage" { ...props }>
        <span role="status" aria-live="polite">{ is_visible ? t( stage_key ) : `` }</span>
        { is_visible && elapsed_seconds > 0 && <span aria-hidden="true">
            { ` · ${ t( `load_elapsed_seconds`, { seconds: elapsed_seconds } ) }` }
        </span> }
    </StageText>

}
