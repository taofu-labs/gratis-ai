import { useState, useEffect, useCallback } from 'react'
import styled, { keyframes } from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Apple, Monitor, Terminal, FolderDown } from 'lucide-react'
import { DISPLAY_NAME, EVENTS } from '../../utils/branding'

const GITHUB_REPO = import.meta.env.VITE_GITHUB_REPO || ``

// Stable download URL that always points to the latest release asset
const download_url = ( filename ) => GITHUB_REPO
    ? `https://github.com/${ GITHUB_REPO }/releases/latest/download/${ filename }`
    : ``

// ── OS detection ────────────────────────────────────────────────

const detect_os = () => {
    const ua = navigator.userAgent || ``
    const platform = navigator.platform || ``
    if( /Mac/i.test( platform ) || /Mac/i.test( ua ) ) return `macos`
    if( /Win/i.test( platform ) || /Win/i.test( ua ) ) return `windows`
    return `linux`
}

// ── Platform metadata ───────────────────────────────────────────

const PLATFORMS = [
    {
        id: `macos`,
        label: `macOS`,
        detail: `Apple Silicon (M1–M4)`,
        file_hint: `.dmg`,
        filename: `gratisAI-mac.dmg`,
        Icon: Apple,
    },
    {
        id: `windows`,
        label: `Windows`,
        detail: `64-bit (x64)`,
        file_hint: `.exe`,
        filename: `gratisAI-win.exe`,
        Icon: Monitor,
    },
    {
        id: `linux`,
        label: `Linux`,
        detail: `AppImage (x64)`,
        file_hint: `.AppImage`,
        filename: `gratisAI-linux.AppImage`,
        Icon: Terminal,
    },
]

// ── Styled components ───────────────────────────────────────────

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
    font-size: clamp( 1rem, 0.9rem + 0.3vw, 1.2rem );
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    margin-bottom: ${ ( { theme } ) => theme.spacing.xl };
    max-width: 460px;
    line-height: 1.6;
`

const CardGrid = styled.div`
    display: flex;
    gap: ${ ( { theme } ) => theme.spacing.lg };
    flex-wrap: wrap;
    justify-content: center;
    margin-bottom: ${ ( { theme } ) => theme.spacing.xl };
    max-width: 880px;
    width: 100%;
`

const Card = styled.div`
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.md };
    padding: ${ ( { theme } ) => `${ theme.spacing.xl } ${ theme.spacing.lg }` };
    border: 2px solid ${ ( { theme, $active } ) =>
        $active ? theme.colors.accent : theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.lg };
    background: ${ ( { theme } ) => theme.colors.surface };
    width: 260px;
    min-height: 220px;
    flex-shrink: 0;

    ${ ( { $active, theme } ) => $active && `
        box-shadow: 0 0 0 1px ${ theme.colors.accent };
    ` }
`

const PlatformIcon = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    background: ${ ( { theme } ) => theme.colors.code_background };
    color: ${ ( { theme } ) => theme.colors.text };
`

const PlatformName = styled.span`
    font-size: 1.1rem;
    font-weight: 600;
    color: ${ ( { theme } ) => theme.colors.text };
`

const PlatformDetail = styled.span`
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

const DownloadButton = styled.a`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.md }` };
    background: ${ ( { theme } ) => theme.colors.accent };
    color: #fff;
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
    width: 100%;
    min-height: 2.5rem;
    margin-top: auto;
    transition: opacity 0.15s;

    &:hover { opacity: 0.85; }
`

const DisabledButton = styled.span`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.md }` };
    background: ${ ( { theme } ) => theme.colors.border };
    color: ${ ( { theme } ) => theme.colors.text_muted };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    font-size: 0.875rem;
    width: 100%;
    min-height: 2.5rem;
    margin-top: auto;
    cursor: default;
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

const Notice = styled.p`
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    margin-bottom: ${ ( { theme } ) => theme.spacing.md };
    max-width: 400px;
    line-height: 1.5;
`

const Footnote = styled.p`
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    margin-bottom: ${ ( { theme } ) => theme.spacing.md };

    a {
        color: ${ ( { theme } ) => theme.colors.text_secondary };
        text-decoration: underline;
        &:hover { color: ${ ( { theme } ) => theme.colors.text }; }
    }
`

// ── Download-started modal ──────────────────────────────────

const fade_in = keyframes`
    from { opacity: 0; transform: scale( 0.95 ) translateY( 8px ); }
    to   { opacity: 1; transform: scale( 1 ) translateY( 0 ); }
`

const Overlay = styled.div`
    position: fixed;
    inset: 0;
    background: ${ ( { theme } ) => theme.colors.modal_overlay };
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
`

const Modal = styled.div`
    animation: ${ fade_in } 0.2s ease-out;
    background: ${ ( { theme } ) => theme.colors.background };
    border-radius: ${ ( { theme } ) => theme.border_radius.lg };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    box-shadow: ${ ( { theme } ) => theme.mode === `dark`
        ? `0 4px 24px rgba( 0, 0, 0, 0.4 )`
        : `0 4px 24px rgba( 0, 0, 0, 0.1 )` };
    width: min( 380px, 90vw );
    padding: ${ ( { theme } ) => theme.spacing.lg };
    text-align: center;
`

const ModalIcon = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3.5rem;
    height: 3.5rem;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    background: ${ ( { theme } ) => theme.colors.input_background };
    color: ${ ( { theme } ) => theme.colors.accent };
    margin: 0 auto ${ ( { theme } ) => theme.spacing.md };
`

const ModalTitle = styled.h2`
    font-size: 1.1rem;
    font-weight: 600;
    color: ${ ( { theme } ) => theme.colors.text };
    margin-bottom: ${ ( { theme } ) => theme.spacing.sm };
`

const ModalDescription = styled.p`
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    font-size: 0.9rem;
    line-height: 1.5;
    margin-bottom: ${ ( { theme } ) => theme.spacing.lg };
`

const ModalFilename = styled.code`
    display: inline-block;
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } ${ theme.spacing.sm }` };
    background: ${ ( { theme } ) => theme.colors.code_background };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    font-size: 0.8rem;
    font-family: ${ ( { theme } ) => theme.fonts.mono };
    color: ${ ( { theme } ) => theme.colors.text_muted };
    margin-bottom: ${ ( { theme } ) => theme.spacing.lg };
`

const ModalDismiss = styled.button`
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.lg }` };
    background: ${ ( { theme } ) => theme.colors.input_background };
    color: ${ ( { theme } ) => theme.colors.text };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    font-size: 0.9rem;
    font-weight: 500;
    transition: opacity 0.15s;
    min-height: 2.5rem;

    &:hover { opacity: 0.8; }
`

const AUTO_DISMISS_MS = 8000

// ── Component ───────────────────────────────────────────────────

/**
 * Download page with OS-specific release links.
 * Detects the user's OS and highlights the matching platform card.
 * @returns {JSX.Element}
 */
export default function GetAppPage() {

    const navigate = useNavigate()
    const { t } = useTranslation( 'pages' )
    const current_os = detect_os()

    // Download-started modal state
    const [ downloading_file, set_downloading_file ] = useState( null )

    const dismiss_modal = useCallback( () => set_downloading_file( null ), [] )

    // Auto-dismiss after a few seconds
    useEffect( () => {
        if( !downloading_file ) return
        const timer = setTimeout( dismiss_modal, AUTO_DISMISS_MS )
        return () => clearTimeout( timer )
    }, [ downloading_file, dismiss_modal ] )

    // Close on Escape key
    useEffect( () => {
        if( !downloading_file ) return
        const handle_close = () => dismiss_modal()
        window.addEventListener( EVENTS.close_modal, handle_close )
        return () => window.removeEventListener( EVENTS.close_modal, handle_close )
    }, [ downloading_file, dismiss_modal ] )

    // Intercept download click — let the native link proceed, then show the modal
    const handle_download_click = ( filename ) => {
        set_downloading_file( filename )
    }

    // Reorder so the detected OS sits in the center
    const ordered_platforms = [
        ...PLATFORMS.filter( p => p.id !== current_os ),
    ]
    const current_platform = PLATFORMS.find( p => p.id === current_os )
    if( current_platform ) ordered_platforms.splice( 1, 0, current_platform )

    return <Container>

        <Title>{ DISPLAY_NAME }</Title>
        <Tagline>
            { t( 'get_app_tagline' ) }
        </Tagline>

        <CardGrid>
            { ordered_platforms.map( ( { id, label, detail, file_hint, filename, Icon } ) => {

                const is_current = id === current_os
                const href = download_url( filename )
                const action = href
                    ? <DownloadButton href={ href } onClick={ () => handle_download_click( filename ) }>
                        { t( 'download_for', { platform: label } ) }
                    </DownloadButton>
                    : <DisabledButton>{ t( 'not_configured' ) }</DisabledButton>

                return <Card key={ id } $active={ is_current }>

                    <PlatformIcon>
                        <Icon size={ 28 } />
                    </PlatformIcon>

                    <PlatformName>{ label }</PlatformName>
                    <PlatformDetail>{ detail } ({ file_hint })</PlatformDetail>

                    { action }

                </Card>

            } ) }
        </CardGrid>

        { GITHUB_REPO && <Footnote>
            { t( 'intel_mac_prompt' ) }{ ` ` }
            <a
                href={ download_url( `gratisAI-mac-intel.dmg` ) }
                onClick={ () => handle_download_click( `gratisAI-mac-intel.dmg` ) }
            >{ t( 'download_intel_build' ) }</a>
        </Footnote> }

        { !GITHUB_REPO && <Notice>
            { t( 'not_configured_notice' ) }
        </Notice> }

        <BackButton onClick={ () => navigate( `/chat` ) }>
            <ArrowLeft size={ 16 } />
            { t( 'or_continue_browser' ) }
        </BackButton>

        { /* Download-started confirmation modal */ }
        { downloading_file && <Overlay onClick={ ( e ) => {
            if( e.target === e.currentTarget ) dismiss_modal()
        } }
        >
            <Modal>

                <ModalIcon>
                    <FolderDown size={ 24 } />
                </ModalIcon>

                <ModalTitle>{ t( 'download_started' ) }</ModalTitle>

                <ModalDescription>
                    { t( 'download_started_description', { name: DISPLAY_NAME } ) }
                </ModalDescription>

                <ModalFilename>{ downloading_file }</ModalFilename>

                <div>
                    <ModalDismiss onClick={ dismiss_modal }>{ t( 'got_it' ) }</ModalDismiss>
                </div>

            </Modal>
        </Overlay> }

    </Container>

}
