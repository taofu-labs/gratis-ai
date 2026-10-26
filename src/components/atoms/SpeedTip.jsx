import styled from 'styled-components'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import SpeedGauge from './SpeedGauge'
import { format_tokens_per_second } from '../../utils/model_catalog'

const Container = styled.div`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: ${ ( { theme } ) => `${ theme.spacing.xs } ${ theme.spacing.sm }` };
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.xs } ${ theme.spacing.sm } ${ theme.spacing.md }` };
    margin-top: ${ ( { theme } ) => theme.spacing.xs };
    font-size: 0.8rem;
    line-height: 1.45;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    background: ${ ( { theme } ) => theme.colors.code_background };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
`

const Message = styled.span`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    flex: 1 1 14rem;
    & svg { flex-shrink: 0; }
`

// Inline text actions: color + underline, per the design rules for inline controls
const TextAction = styled.button`
    min-height: 2rem;
    font-size: 0.8rem;
    font-weight: ${ ( { $primary } ) => $primary ? 600 : 400 };
    color: ${ ( { theme, $primary } ) => $primary ? theme.colors.accent : theme.colors.text_muted };
    text-decoration: underline;
    text-underline-offset: 2px;
    white-space: nowrap;
    &:hover { color: ${ ( { theme, $primary } ) => $primary ? theme.colors.accent_hover : theme.colors.text }; }
`

const Dismiss = styled.button`
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 2rem;
    min-height: 2rem;
    margin-left: auto;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    border-radius: ${ ( { theme } ) => theme.border_radius.sm };
    &:hover { color: ${ ( { theme } ) => theme.colors.text }; }
`

/**
 * One inline offer under a reply: slow replies suggest the Faster mode,
 * very fast ones the Smarter mode. Shown once per session (the parent decides).
 *
 * @param {Object} props
 * @param {{ priority: 'faster'|'better', model: Object, cached: boolean }} props.target - Mode on offer
 * @param {number} props.tokens_per_second - Measured speed of the reply it sits under
 * @param {Function} props.on_accept - Switch (or download) the target mode
 * @param {Function} props.on_dismiss - Hide for this session
 * @param {Function} props.on_disable - Never show speed tips again
 * @returns {JSX.Element}
 */
export default function SpeedTip( { target, tokens_per_second, on_accept, on_dismiss, on_disable } ) {

    const { t } = useTranslation( `models` )
    const speed = format_tokens_per_second( tokens_per_second )
    const mode = t( `mode_${ target.priority }` )

    return <Container data-testid="speed-tip" data-direction={ target.priority } role="status">

        <Message>
            <SpeedGauge mode={ target.priority } />
            { t( `speed_tip_${ target.priority }`, { speed, name: target.model.name } ) }
        </Message>

        <TextAction type="button" $primary data-testid="speed-tip-accept" onClick={ on_accept }>
            { target.cached ? t( `speed_tip_switch`, { mode } ) : t( `speed_tip_get`, { mode } ) }
        </TextAction>

        <TextAction type="button" data-testid="speed-tip-disable" onClick={ on_disable }>
            { t( `speed_tip_disable` ) }
        </TextAction>

        <Dismiss type="button" data-testid="speed-tip-dismiss" onClick={ on_dismiss } aria-label={ t( `common:aria_dismiss` ) }>
            <X size={ 14 } />
        </Dismiss>

    </Container>

}
