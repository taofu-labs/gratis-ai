import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import styled, { keyframes } from 'styled-components'
import { Check, Cloud, Smartphone, X, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Button from '../atoms/Button'
import use_dialog from '../../hooks/use_dialog'
import use_pro_store from '../../stores/pro_store'
import { AllowanceMeter } from './ProSettings'

const rise_in = keyframes`
    from { opacity: 0; transform: translateY( 8px ); }
    to { opacity: 1; transform: none; }
`

const Overlay = styled.div`
    position: fixed;
    inset: 0;
    background: ${ ( { theme } ) => theme.colors.modal_overlay };
    display: flex;
    align-items: center;
    justify-content: center;
    padding: ${ ( { theme } ) => theme.spacing.md };
    z-index: 1000;
`

const Panel = styled.div`
    background: ${ ( { theme } ) => theme.colors.background };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.lg };
    box-shadow: 0 4px 24px rgba( 0, 0, 0, ${ ( { theme } ) => theme.mode === `dark` ? 0.4 : 0.1 } );
    width: min( 680px, 100% );
    max-height: 90vh;
    overflow-y: auto;
    padding: ${ ( { theme } ) => theme.spacing.xl };
    display: grid;
    gap: ${ ( { theme } ) => theme.spacing.lg };
    animation: ${ rise_in } 0.5s cubic-bezier( 0.2, 0.8, 0.2, 1 );

    &:focus-visible { outline: none; }

    @media ( max-width: ${ ( { theme } ) => theme.breakpoints.mobile } ) {
        padding: ${ ( { theme } ) => theme.spacing.lg };
        gap: ${ ( { theme } ) => theme.spacing.md };
    }

    @media ( prefers-reduced-motion: reduce ) { animation: none; }
`

const Head = styled.div`
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: ${ ( { theme } ) => theme.spacing.md };
`

const Intro = styled.div`
    display: grid;
    gap: ${ ( { theme } ) => theme.spacing.sm };
`

export const ProTag = styled.span`
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    justify-self: start;
    font-size: 0.8rem;
    font-weight: 700;
    padding: 0.125rem 0.5rem;
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    background: ${ ( { theme } ) => `${ theme.colors.accent }26` };
    color: ${ ( { theme } ) => theme.colors.accent_text };
    white-space: nowrap;
`

const Title = styled.h2`
    font-size: 1.6rem;
    text-wrap: balance;

    @media ( max-width: ${ ( { theme } ) => theme.breakpoints.mobile } ) { font-size: 1.35rem; }
`

const Body = styled.p`
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    line-height: 1.5;
`

const CloseButton = styled.button`
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 2.75rem;
    min-height: 2.75rem;
    margin: -0.5rem -0.5rem 0 0;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    &:hover { color: ${ ( { theme } ) => theme.colors.text }; }
`

const Columns = styled.div`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: ${ ( { theme } ) => theme.spacing.md };

    @media ( max-width: ${ ( { theme } ) => theme.breakpoints.mobile } ) {
        grid-template-columns: 1fr;
        gap: ${ ( { theme } ) => theme.spacing.sm };
    }
`

const Column = styled.section`
    border: 1px solid ${ ( { theme, $pro } ) => $pro ? theme.colors.accent : theme.colors.border };
    background: ${ ( { theme, $pro } ) => $pro ? `${ theme.colors.accent }14` : theme.colors.surface };
    border-radius: ${ ( { theme } ) => theme.border_radius.lg };
    padding: ${ ( { theme } ) => theme.spacing.md } ${ ( { theme } ) => theme.spacing.lg };
    display: grid;
    align-content: start;
    gap: ${ ( { theme } ) => theme.spacing.sm };
`

const ColumnHead = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${ ( { theme } ) => theme.spacing.sm };

    h3 {
        display: flex;
        align-items: center;
        gap: ${ ( { theme } ) => theme.spacing.sm };
        font-size: 1.05rem;
    }
`

const Status = styled.span`
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.125rem 0.5rem;
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    background: ${ ( { theme } ) => theme.colors.surface_hover };
    color: ${ ( { theme } ) => theme.colors.text_secondary };
`

const Subtitle = styled.div`
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

const Points = styled.ul`
    list-style: none;
    display: grid;
    gap: 0.375rem;
    font-size: 0.9rem;

    li {
        display: flex;
        gap: ${ ( { theme } ) => theme.spacing.sm };
        align-items: flex-start;
    }

    svg {
        flex-shrink: 0;
        margin-top: 0.2rem;
        color: ${ ( { theme } ) => theme.colors.success };
    }
`

const Actions = styled.div`
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: ${ ( { theme } ) => theme.spacing.sm };

    @media ( max-width: ${ ( { theme } ) => theme.breakpoints.mobile } ) {
        flex-direction: column-reverse;
        & > button { width: 100%; min-height: 2.75rem; }
    }
`

const Footnote = styled.p`
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    text-align: right;

    @media ( max-width: ${ ( { theme } ) => theme.breakpoints.mobile } ) { text-align: center; }
`

const FREE_POINTS = [ `free_point_unlimited`, `free_point_offline`, `free_point_private`, `free_point_no_account` ]
const PRO_POINTS = [ `pro_point_models`, `pro_point_fast`, `pro_point_cloud`, `pro_point_switch` ]

/**
 * "Gratis is free. Forever." — the Free vs Pro explainer. Rendered once at the
 * app root; any Pro surface opens it through the pro store.
 * @returns {JSX.Element|null}
 */
export default function ProDialog() {

    const { t } = useTranslation( `pro` )
    const { explainer_open: is_open, close_explainer, signed_in, usage, sign_in, refresh } = use_pro_store()
    const { title_id, overlay_props, dialog_props } = use_dialog( { is_open, on_close: close_explainer } )

    // Fresh allowance whenever a signed-in user opens it
    useEffect( () => {
        if( is_open && signed_in ) refresh()
    }, [ is_open, signed_in, refresh ] )

    if( !is_open ) return null

    const points = ( keys ) => <Points>
        { keys.map( key => <li key={ key }><Check size={ 16 } />{ t( key ) }</li> ) }
    </Points>

    return createPortal( <Overlay data-testid="pro-dialog" { ...overlay_props }>
        <Panel { ...dialog_props } tabIndex={ -1 }>

            <Head>
                <Intro>
                    <ProTag><Zap size={ 14 } />{ t( `gratis_pro` ) }</ProTag>
                    <Title id={ title_id }>{ t( `explainer_title` ) }</Title>
                    <Body>{ t( `explainer_body` ) }</Body>
                </Intro>
                <CloseButton onClick={ close_explainer } aria-label={ t( `common:close` ) }><X size={ 18 } /></CloseButton>
            </Head>

            <Columns>
                <Column>
                    <ColumnHead>
                        <h3><Smartphone size={ 18 } />{ t( `free_title` ) }</h3>
                        { !signed_in && <Status>{ t( `current` ) }</Status> }
                    </ColumnHead>
                    <Subtitle>{ t( `free_subtitle` ) }</Subtitle>
                    { points( FREE_POINTS ) }
                </Column>
                <Column $pro>
                    <ColumnHead>
                        <h3><Cloud size={ 18 } />{ t( `pro_title` ) }</h3>
                        { signed_in && <Status>{ t( `active` ) }</Status> }
                    </ColumnHead>
                    <Subtitle>{ t( `pro_subtitle` ) }</Subtitle>
                    { points( PRO_POINTS ) }
                    { signed_in && usage && <AllowanceMeter usage={ usage } /> }
                </Column>
            </Columns>

            <Actions>
                { signed_in
                    ? <Button data-testid="pro-done-btn" onClick={ close_explainer }>{ t( `done` ) }</Button>
                    : <>
                        <Button $variant="secondary" data-testid="pro-keep-free-btn" onClick={ close_explainer }>{ t( `keep_free` ) }</Button>
                        <Button data-testid="pro-sign-in-btn" onClick={ () => sign_in() }><Zap size={ 16 } />{ t( `sign_in` ) }</Button>
                    </> }
            </Actions>

            <Footnote>{ t( `local_stays` ) }</Footnote>

        </Panel>
    </Overlay>, document.body )

}
