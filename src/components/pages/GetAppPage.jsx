import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Laptop, ShieldCheck, Zap } from 'lucide-react'
import BrandMark from '../atoms/BrandMark'
import { DISPLAY_NAME } from '../../utils/branding'

const Container = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: ${ ( { theme } ) => theme.spacing.xl };
    text-align: center;
`

const Panel = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    width: min( 100%, 620px );
`

const Eyebrow = styled.div`
    margin-top: ${ ( { theme } ) => theme.spacing.md };
    margin-bottom: ${ ( { theme } ) => theme.spacing.sm };
    color: ${ ( { theme } ) => theme.colors.accent };
    font-family: ${ ( { theme } ) => theme.fonts.mono };
    font-size: 0.75rem;
    text-transform: uppercase;
`

const Title = styled.h1`
    font-size: clamp( 2rem, 1.5rem + 2vw, 3rem );
    color: ${ ( { theme } ) => theme.colors.text };
    border-bottom: 3px solid ${ ( { theme } ) => theme.colors.accent };
    margin-bottom: ${ ( { theme } ) => theme.spacing.lg };
`

const Tagline = styled.p`
    font-size: clamp( 1rem, 0.9rem + 0.3vw, 1.15rem );
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    margin-bottom: ${ ( { theme } ) => theme.spacing.xl };
    max-width: 520px;
    line-height: 1.6;
`

const FeatureRow = styled.div`
    display: grid;
    grid-template-columns: repeat( 3, minmax( 0, 1fr ) );
    gap: ${ ( { theme } ) => theme.spacing.sm };
    width: 100%;
    margin-bottom: ${ ( { theme } ) => theme.spacing.xl };

    @media ( max-width: 680px ) {
        grid-template-columns: 1fr;
    }
`

const Feature = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    padding: ${ ( { theme } ) => theme.spacing.md };
    background: ${ ( { theme } ) => theme.colors.surface };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    font-size: 0.88rem;
    text-align: left;
`

const IconWrap = styled.span`
    display: inline-flex;
    color: ${ ( { theme } ) => theme.colors.accent };
`

const BackButton = styled.button`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.md }` };
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    font-size: 0.9rem;
    transition: color 0.15s;
    min-height: 2.75rem;

    &:hover { color: ${ ( { theme } ) => theme.colors.text }; }
`

export default function GetAppPage() {

    const navigate = useNavigate()
    const { t } = useTranslation( `pages` )
    const title = t( `desktop_in_works_title`, {
        defaultValue: `Desktop app in the works`,
    } )
    const description = t( `desktop_in_works_description`, {
        name: DISPLAY_NAME,
        defaultValue: `${ DISPLAY_NAME } desktop builds are being prepared. For now, the browser version keeps running models locally on your device.`,
    } )

    return <Container>
        <Panel>
            <BrandMark size="3.25rem" />
            <Eyebrow>True Performance Network</Eyebrow>
            <Title>{ title }</Title>
            <Tagline>{ description }</Tagline>

            <FeatureRow>
                <Feature>
                    <IconWrap><Zap size={ 18 } /></IconWrap>
                    <span>{ t( `desktop_in_works_speed`, { defaultValue: `More memory headroom for larger models` } ) }</span>
                </Feature>
                <Feature>
                    <IconWrap><ShieldCheck size={ 18 } /></IconWrap>
                    <span>{ t( `desktop_in_works_privacy`, { defaultValue: `Same local-first privacy model` } ) }</span>
                </Feature>
                <Feature>
                    <IconWrap><Laptop size={ 18 } /></IconWrap>
                    <span>{ t( `desktop_in_works_models`, { defaultValue: `Built for TPN winner models` } ) }</span>
                </Feature>
            </FeatureRow>

            <BackButton onClick={ () => navigate( `/chat` ) }>
                <ArrowLeft size={ 16 } />
                { t( `or_continue_browser`, { defaultValue: `Continue in your browser` } ) }
            </BackButton>
        </Panel>
    </Container>

}
