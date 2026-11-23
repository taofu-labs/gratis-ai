import { useEffect } from 'react'
import styled from 'styled-components'
import { Heart, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Button from '../atoms/Button'
import Switch from '../atoms/Switch'
import use_pro_store from '../../stores/pro_store'
import { GRATIS_BASE_URL } from '../../utils/gratis_auth'

const Stack = styled.div`
    display: grid;
    gap: ${ ( { theme } ) => theme.spacing.md };
`

const PromiseBox = styled.div`
    display: flex;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.md }` };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    background: ${ ( { theme } ) => theme.colors.surface };
    border: 1px solid ${ ( { theme } ) => theme.colors.border_subtle };
    font-size: 0.875rem;
    line-height: 1.5;

    svg { flex-shrink: 0; margin-top: 0.2rem; color: ${ ( { theme } ) => theme.colors.accent_text }; }
    p { color: ${ ( { theme } ) => theme.colors.text_secondary }; }
`

const Row = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: ${ ( { theme } ) => theme.spacing.sm } ${ ( { theme } ) => theme.spacing.md };
`

const RowText = styled.div`
    min-width: 0;
    font-size: 0.9rem;
`

const RowLabel = styled.div`
    font-weight: 600;
`

const RowHint = styled.div`
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

const RowActions = styled.div`
    display: flex;
    gap: ${ ( { theme } ) => theme.spacing.sm };
`

const Divider = styled.hr`
    border: 0;
    height: 1px;
    background: ${ ( { theme } ) => theme.colors.border_subtle };
`

const Meter = styled.div`
    display: grid;
    gap: 0.25rem;
    min-width: 9rem;
    font-size: 0.75rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    text-align: right;
    font-variant-numeric: tabular-nums;
`

const Track = styled.div`
    height: 6px;
    border-radius: ${ ( { theme } ) => theme.border_radius.sm };
    background: ${ ( { theme } ) => theme.colors.border };
    overflow: hidden;

    div {
        height: 100%;
        background: ${ ( { theme } ) => theme.colors.accent };
        transition: width 0.4s;
    }
`

/**
 * Weekly allowance bar: "34% used · resets Thu"
 * @param {Object} props
 * @param {{ percent_used?: number, resets_at?: string }} props.usage - /v1/usage response
 * @returns {JSX.Element}
 */
export function AllowanceMeter( { usage } ) {

    const { t, i18n } = useTranslation( `pro` )
    const percent = Math.min( 100, Math.max( 0, Math.round( usage?.percent_used ?? 0 ) ) )
    const resets = usage?.resets_at && new Date( usage.resets_at ).toLocaleDateString( i18n.language, { weekday: `short` } )

    return <Meter data-testid="pro-allowance">
        <Track role="meter" aria-valuenow={ percent } aria-valuemin={ 0 } aria-valuemax={ 100 } aria-label={ t( `allowance` ) }>
            <div style={ { width: `${ percent }%` } } />
        </Track>
        <span>
            { t( `allowance_used`, { percent } ) }
            { resets ? ` · ${ t( `allowance_resets`, { date: resets } ) }` : `` }
        </span>
    </Meter>

}

/**
 * Settings → Pro tab: free-forever promise, Gratis account, cloud model visibility, allowance
 * @returns {JSX.Element}
 */
export default function ProSettings() {

    const { t } = useTranslation( `pro` )
    const { signed_in, usage, show_pro_models, set_show_pro_models, sign_in, sign_out, refresh } = use_pro_store()

    useEffect( () => {
        refresh()
    }, [ refresh ] )

    const plan = usage?.tier?.name

    return <Stack data-testid="pro-settings">

        <PromiseBox>
            <Heart size={ 16 } />
            <div>
                <strong>{ t( `settings_promise_title` ) }</strong>
                <p>{ t( `settings_promise_body` ) }</p>
            </div>
        </PromiseBox>

        <Row>
            <RowText>
                <RowLabel>{ t( `account` ) }</RowLabel>
                <RowHint data-testid="pro-account-status">
                    { signed_in ? plan ? t( `signed_in_plan`, { plan } ) : t( `signed_in` ) : t( `signed_out` ) }
                </RowHint>
            </RowText>
            <RowActions>
                { signed_in
                    ? <>
                        <Button as="a" $variant="secondary" href={ GRATIS_BASE_URL } target="_blank" rel="noopener noreferrer">{ t( `manage_plan` ) }</Button>
                        <Button $variant="secondary" data-testid="pro-sign-out-btn" onClick={ sign_out }>{ t( `sign_out` ) }</Button>
                    </>
                    : <Button data-testid="pro-settings-sign-in-btn" onClick={ () => sign_in() }><Zap size={ 16 } />{ t( `sign_in` ) }</Button> }
            </RowActions>
        </Row>

        { signed_in && usage && <Row>
            <RowText>
                <RowLabel>{ t( `allowance` ) }</RowLabel>
                <RowHint>{ t( `allowance_hint` ) }</RowHint>
            </RowText>
            <AllowanceMeter usage={ usage } />
        </Row> }

        <Divider />

        <Switch
            data-testid="pro-show-models-switch"
            on={ show_pro_models }
            on_toggle={ () => set_show_pro_models( !show_pro_models ) }
            label={ <RowText>
                <RowLabel>{ t( `show_models` ) }</RowLabel>
                <RowHint>{ t( `show_models_hint` ) }</RowHint>
            </RowText> }
        />

    </Stack>

}
