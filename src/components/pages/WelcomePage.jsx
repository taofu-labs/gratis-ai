import { useState } from 'react'
import styled, { keyframes } from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Shield, WifiOff, ChevronDown, ChevronUp } from 'lucide-react'
import use_device_capabilities from '../../hooks/use_device_capabilities'
import DeviceInfo from '../atoms/DeviceInfo'
import LanguageSelector from '../molecules/LanguageSelector'
import { DISPLAY_NAME } from '../../utils/branding'

const PageWrapper = styled.div`
    position: relative;
    display: flex;
    flex: 1;
`

const TopRight = styled.div`
    position: absolute;
    top: ${ ( { theme } ) => theme.spacing.md };
    right: ${ ( { theme } ) => theme.spacing.md };
    z-index: 10;
`

const Container = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: ${ ( { theme } ) => theme.spacing.xl };
    text-align: center;
`

const Title = styled.h1`
    font-size: clamp( 2rem, 1.5rem + 2.5vw, 3rem );
    color: ${ ( { theme } ) => theme.colors.text };
    border-bottom: 3px solid ${ ( { theme } ) => theme.colors.accent };
    margin-bottom: 2rem;
`

const Tagline = styled.p`
    font-size: clamp( 1.1rem, 1rem + 0.3vw, 1.35rem );
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    margin-bottom: ${ ( { theme } ) => theme.spacing.lg };
    max-width: 500px;
    line-height: 1.6;
    text-align: center;
`

// Simple value props that anyone can understand
const ValueProps = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${ ( { theme } ) => theme.spacing.md };
    margin-bottom: ${ ( { theme } ) => theme.spacing.xl };
    max-width: 380px;
    width: 100%;
`

const ValueProp = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.md };
    text-align: left;
    font-size: 0.95rem;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    line-height: 1.4;
`

const IconCircle = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    min-width: 40px;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    background: ${ ( { theme } ) => theme.colors.code_background };
    color: ${ ( { theme } ) => theme.colors.text };
`

const StartButton = styled.button`
    background: ${ ( { theme } ) => theme.colors.accent };
    color: white;
    padding: ${ ( { theme } ) => `${ theme.spacing.md } ${ theme.spacing.xl }` };
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    font-size: 1.1rem;
    font-weight: 600;
    transition: opacity 0.15s;
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    min-height: 2.75rem;

    &:hover { opacity: 0.85; }

    &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
`

// Step indicator showing the 3-step onboarding
const StepIndicator = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    margin-top: ${ ( { theme } ) => theme.spacing.lg };
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

const StepDot = styled.div`
    width: 8px;
    height: 8px;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    background: ${ ( { theme, $active } ) => $active ? theme.colors.accent : theme.colors.border };
`

const StepLine = styled.div`
    width: 24px;
    height: 2px;
    background: ${ ( { theme } ) => theme.colors.border };
`

// Expandable device details
const DetailsToggle = styled.button`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    margin-top: ${ ( { theme } ) => theme.spacing.md };
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    transition: color 0.15s;
    min-height: 2.75rem;

    &:hover { color: ${ ( { theme } ) => theme.colors.text_secondary }; }
`

const DetailsPanel = styled.div`
    overflow: hidden;
    max-height: ${ ( { $expanded } ) => $expanded ? `200px` : `0px` };
    opacity: ${ ( { $expanded } ) => $expanded ? 1 : 0 };
    visibility: ${ ( { $expanded } ) => $expanded ? `visible` : `hidden` };
    transition: max-height 0.3s ease, opacity 0.2s ease, visibility 0.3s ease;

    @media ( prefers-reduced-motion: reduce ) {
        transition: none;
    }
`

// Pulsing dot for "detecting" state
const pulse = keyframes`
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
`

const DetectingDot = styled.span`
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    background: ${ ( { theme } ) => theme.colors.accent };
    animation: ${ pulse } 1.5s ease-in-out infinite;
    margin-right: ${ ( { theme } ) => theme.spacing.xs };

    @media ( prefers-reduced-motion: reduce ) {
        animation: none;
    }
`

/**
 * Landing page with app intro and device detection.
 * Designed to be warm and approachable — technical specs hidden behind "details".
 * @returns {JSX.Element}
 */
export default function WelcomePage() {

    const { t } = useTranslation( 'pages' )
    const navigate = useNavigate()
    const { capabilities, is_detecting } = use_device_capabilities()
    const [ show_details, set_show_details ] = useState( false )

    const handle_start = () => {
        if( !is_detecting ) navigate( `/select-model`, { state: { capabilities } } )
    }

    return <PageWrapper>

        <TopRight>
            <LanguageSelector />
        </TopRight>

        <Container>

            <Title>{ DISPLAY_NAME }</Title>
            <Tagline>
                { t( 'tagline' ) }
            </Tagline>

            { /* Simple value propositions anyone can understand */ }
            <ValueProps>
                <ValueProp>
                    <IconCircle><Shield size={ 18 } /></IconCircle>
                    <span>{ t( 'value_prop_privacy' ) }</span>
                </ValueProp>
                <ValueProp>
                    <IconCircle><WifiOff size={ 18 } /></IconCircle>
                    <span>{ t( 'value_prop_offline' ) }</span>
                </ValueProp>
            </ValueProps>

            <StartButton
                data-testid="get-started-btn"
                onClick={ handle_start }
                disabled={ is_detecting }
            >
                { is_detecting
                    ? <><DetectingDot /> { t( 'checking_device' ) }</>
                    : <>{ t( 'get_started' ) } <ArrowRight size={ 18 } /></> }
            </StartButton>

            { /* Step progress indicator */ }
            <StepIndicator data-testid="step-indicator">
                <StepDot $active />
                <StepLine />
                <StepDot />
                <StepLine />
                <StepDot />
            </StepIndicator>

            { /* Device details — hidden by default (progressive disclosure) */ }
            { capabilities && <>
                <DetailsToggle
                    data-testid="device-details-toggle"
                    onClick={ () => set_show_details( !show_details ) }
                >
                    { show_details ? t( 'hide_device_details' ) : t( 'show_device_details' ) }
                    { show_details ? <ChevronUp size={ 14 } /> : <ChevronDown size={ 14 } /> }
                </DetailsToggle>
                <DetailsPanel $expanded={ show_details }>
                    <DeviceInfo capabilities={ capabilities } />
                </DetailsPanel>
            </> }

        </Container>

    </PageWrapper>

}
