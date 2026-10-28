import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BunnyEating } from '../atoms/Bunny'

const Container = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: ${ ( { theme } ) => theme.spacing.xl };
    text-align: center;
`

const Code = styled.span`
    font-family: ${ ( { theme } ) => theme.fonts.mono };
    font-size: clamp( 2.5rem, 2rem + 3vw, 4rem );
    font-weight: 500;
    letter-spacing: -0.03em;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    line-height: 1;
`

const Title = styled.h1`
    font-size: clamp( 1.2rem, 1rem + 1vw, 1.5rem );
    color: ${ ( { theme } ) => theme.colors.text };
    margin-top: ${ ( { theme } ) => theme.spacing.md };
    margin-bottom: 2rem;
`

const Description = styled.p`
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    margin-bottom: ${ ( { theme } ) => theme.spacing.lg };
    max-width: 360px;
    line-height: 1.5;
    font-size: 0.95rem;
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

/**
 * 404 page shown for unrecognised routes
 * @returns {JSX.Element}
 */
export default function NotFoundPage() {

    const navigate = useNavigate()
    const { t } = useTranslation( `pages` )

    return <Container>
        <BunnyEating size={ 112 } />
        <Code>404</Code>
        <Title>{ t( `not_found_title` ) }</Title>
        <Description>
            { t( `not_found_description` ) }
        </Description>
        <BackButton onClick={ () => navigate( `/chat` ) }>
            <ArrowLeft size={ 16 } />
            { t( `back_to_chat` ) }
        </BackButton>
    </Container>

}
