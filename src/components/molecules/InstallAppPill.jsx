import styled from 'styled-components'
import { Link, useLocation } from 'react-router-dom'
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import Button from '../atoms/Button'
import { is_ios, is_standalone, use_app_update_store } from '../../utils/app_update'

const is_mobile_os = () => /Android|iPhone|iPad|iPod/i.test( navigator.userAgent ) || is_ios()

const Dock = styled.div`
    position: fixed;
    left: ${ ( { theme } ) => theme.spacing.md };
    bottom: calc( ${ ( { theme } ) => theme.spacing.md } + env( safe-area-inset-bottom ) );
    z-index: 20;
    display: flex;
`

// A secondary pill floating over content needs an opaque face
const FloatingPill = styled( Button )`
    background: ${ ( { theme } ) => theme.colors.background };
    box-shadow: ${ ( { theme } ) => theme.mode === `dark`
        ? `0 2px 12px rgba( 0, 0, 0, 0.4 )`
        : `0 2px 12px rgba( 0, 0, 0, 0.12 )` };
`

/**
 * Bottom-left "Install app" pill: desktop links to the native apps, mobile
 * installs the PWA. Hidden when already installed, inside the desktop app, and in chat.
 * @returns {JSX.Element|null}
 */
export default function InstallAppPill() {

    const { t } = useTranslation( `common` )
    const { pathname } = useLocation()
    const install_prompt = use_app_update_store( state => state.install_prompt )

    if( window.electronAPI?.native_inference ) return null

    // Off the chat (its input and sidebar footer own the bottom edge) and the app page itself
    const out_of_place = pathname.startsWith( `/chat` ) || pathname === `/get-app`

    // Desktop has native apps; phones install the PWA (iOS only by hand)
    const install = is_standalone() || out_of_place ? null
        : !is_mobile_os() ? `native`
            : install_prompt ? `prompt`
                : is_ios() ? `ios`
                    : null

    if( !install ) return null

    const prompt_install = async () => {
        if( install === `ios` ) return toast( t( `install_ios_hint` ), { duration: 6000 } )
        // A prompt shows once; Chrome fires a fresh beforeinstallprompt if it may ask again
        use_app_update_store.setState( { install_prompt: null } )
        await install_prompt.prompt()
    }

    return <Dock>

        { install === `native` && <FloatingPill as={ Link } to="/get-app" $variant="secondary" data-testid="install-app-pill">
            <Download size={ 16 } /> { t( `install_app` ) }
        </FloatingPill> }

        { ( install === `prompt` || install === `ios` ) && <FloatingPill $variant="secondary" data-testid="install-app-pill" onClick={ prompt_install }>
            <Download size={ 16 } /> { t( `install_app` ) }
        </FloatingPill> }

    </Dock>

}
