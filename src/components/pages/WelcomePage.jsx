import { useState } from 'react'
import styled, { keyframes } from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, ChevronDown, ChevronUp, Settings, ShieldCheck, WifiOff } from 'lucide-react'
import use_device_capabilities from '../../hooks/use_device_capabilities'
import DeviceInfo from '../atoms/DeviceInfo'
import LanguageSelector from '../molecules/LanguageSelector'
import SettingsModal from '../molecules/SettingsModal'
import BrandMark from '../atoms/BrandMark'
import ConvergenceCanvas from '../atoms/ConvergenceCanvas'
import { DISPLAY_NAME } from '../../utils/branding'

const PageWrapper = styled.div`
    position: relative;
    display: flex;
    flex: 1;
    overflow: hidden;
    background: ${ ( { theme } ) => theme.colors.background };
    isolation: isolate;

    &::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 1;
        background: radial-gradient( ellipse 58% 52% at 50% 44%, transparent 24%, ${ ( { theme } ) => theme.colors.background } 82% );
        pointer-events: none;
    }
`

const TopRight = styled.div`
    position: absolute;
    top: ${ ( { theme } ) => theme.spacing.md };
    right: ${ ( { theme } ) => theme.spacing.md };
    z-index: 4;
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
`

const IconButton = styled.button`
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 2.75rem;
    min-height: 2.75rem;
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    color: ${ ( { theme } ) => theme.colors.text_muted };
    transition: color 0.15s;

    &:hover { color: ${ ( { theme } ) => theme.colors.text }; }
`

const Container = styled.main`
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: ${ ( { theme } ) => theme.spacing.xl };
    text-align: center;
`

const HeroStack = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.lg };
    width: 100%;
    max-width: 37.5rem;
`

const Eyebrow = styled.p`
    margin: 0;
    font-family: ${ ( { theme } ) => theme.fonts.mono };
    font-size: 0.72rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: ${ ( { theme } ) => theme.colors.accent };
`

const TitleGroup = styled.div`
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.md };
`

const Title = styled.h1`
    margin: 0;
    font-size: clamp( 3rem, 7vw, 5.125rem );
    line-height: 1;
    color: ${ ( { theme } ) => theme.colors.text };
`

const SignalRule = styled.span`
    display: block;
    width: 7.25rem;
    height: 3px;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    background: ${ ( { theme } ) => theme.colors.accent };
`

const Tagline = styled.p`
    margin: 0;
    max-width: 32rem;
    font-size: 1.08rem;
    line-height: 1.6;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    text-wrap: pretty;
`

const ValueProps = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${ ( { theme } ) => theme.spacing.md };
    width: 100%;
    max-width: 29rem;
`

const ValueProp = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.md };
    text-align: left;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    line-height: 1.45;
`

const IconTile = styled.span`
    display: grid;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
    flex-shrink: 0;
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.lg };
    background: ${ ( { theme } ) => theme.colors.surface };
    color: ${ ( { theme } ) => theme.colors.accent };
`

const StartButton = styled.button`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    min-height: 3.25rem;
    margin-top: ${ ( { theme } ) => theme.spacing.xs };
    padding: 0 ${ ( { theme } ) => theme.spacing.xl };
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    background: ${ ( { theme } ) => theme.colors.accent };
    color: ${ ( { theme } ) => theme.colors.accent_ink };
    font-weight: 700;
    transition: background 0.15s, opacity 0.15s;

    &:hover { background: ${ ( { theme } ) => theme.colors.accent_hover }; }

    &:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }
`

const StepIndicator = styled.div`
    display: flex;
    align-items: center;
    margin-top: ${ ( { theme } ) => theme.spacing.sm };
`

const StepDot = styled.span`
    width: ${ ( { $active } ) => $active ? `10px` : `8px` };
    height: ${ ( { $active } ) => $active ? `10px` : `8px` };
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    background: ${ ( { theme, $active, $done } ) => $active || $done ? theme.colors.accent : theme.colors.border_control };
    box-shadow: ${ ( { $active } ) => $active ? `0 0 0 4px rgba( 255, 90, 31, 0.18 )` : `none` };
`

const StepLine = styled.span`
    width: 2.625rem;
    height: 2px;
    background: ${ ( { theme, $done } ) => $done ? theme.colors.accent : theme.colors.border_control };
`

const DetailsToggle = styled.button`
    display: inline-flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    min-height: 2.75rem;
    margin-top: ${ ( { theme } ) => theme.spacing.xs };
    color: ${ ( { theme } ) => theme.colors.text_muted };
    font-size: 0.86rem;
    transition: color 0.15s;

    &:hover { color: ${ ( { theme } ) => theme.colors.text_secondary }; }
`

const DetailsPanel = styled.div`
    overflow: hidden;
    max-height: ${ ( { $expanded } ) => $expanded ? `15rem` : `0` };
    opacity: ${ ( { $expanded } ) => $expanded ? 1 : 0 };
    visibility: ${ ( { $expanded } ) => $expanded ? `visible` : `hidden` };
    transition: max-height 0.3s ease, opacity 0.2s ease, visibility 0.3s ease;

    @media ( prefers-reduced-motion: reduce ) {
        transition: none;
    }
`

const pulse = keyframes`
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
`

const DetectingDot = styled.span`
    width: 8px;
    height: 8px;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    background: ${ ( { theme } ) => theme.colors.accent_ink };
    animation: ${ pulse } 1.5s ease-in-out infinite;

    @media ( prefers-reduced-motion: reduce ) {
        animation: none;
    }
`

/**
 * Landing page with app intro and device detection.
 * @returns {JSX.Element}
 */
export default function WelcomePage( { theme_preference, on_theme_toggle } ) {

    const { t } = useTranslation( 'pages' )
    const navigate = useNavigate()
    const { capabilities, is_detecting } = use_device_capabilities()
    const [ show_details, set_show_details ] = useState( false )
    const [ settings_open, set_settings_open ] = useState( false )

    const handle_start = () => {
        if( !is_detecting ) navigate( `/select-model`, { state: { capabilities } } )
    }

    return <PageWrapper>

        <ConvergenceCanvas centerX={ 0.5 } />

        <TopRight>
            <LanguageSelector />
            <IconButton
                data-testid="settings-btn"
                onClick={ () => set_settings_open( true ) }
                aria-label={ t( `common:aria_open_settings` ) }
            >
                <Settings size={ 18 } />
            </IconButton>
        </TopRight>

        <Container>
            <HeroStack>
                <BrandMark size="3.25rem" />
                <Eyebrow>True Performance Network</Eyebrow>

                <TitleGroup>
                    <Title>{ DISPLAY_NAME }</Title>
                    <SignalRule />
                </TitleGroup>

                <Tagline>{ t( 'tagline' ) }</Tagline>

                <ValueProps>
                    <ValueProp>
                        <IconTile><ShieldCheck size={ 20 } /></IconTile>
                        <span>{ t( 'value_prop_privacy' ) }</span>
                    </ValueProp>
                    <ValueProp>
                        <IconTile><WifiOff size={ 20 } /></IconTile>
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

                <StepIndicator data-testid="step-indicator">
                    <StepDot $active />
                    <StepLine />
                    <StepDot />
                    <StepLine />
                    <StepDot />
                </StepIndicator>

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
            </HeroStack>
        </Container>

        <SettingsModal
            is_open={ settings_open }
            on_close={ () => set_settings_open( false ) }
            theme_preference={ theme_preference }
            on_theme_change={ on_theme_toggle }
        />

    </PageWrapper>

}
