import { useEffect } from 'react'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { ThemeProvider } from 'styled-components'
import { QueryParamProvider } from 'use-query-params'
import { ReactRouter6Adapter } from 'use-query-params/adapters/react-router-6'
import { Toaster } from 'react-hot-toast'
import GlobalStyle from './styles/GlobalStyle'
import ErrorBoundary from './components/molecules/ErrorBoundary'
import use_theme from './hooks/use_theme'
import DesktopAppBanner from './components/atoms/DesktopAppBanner'
import Routes from './routes/Routes'
import { register_shortcuts } from './utils/keyboard_shortcuts'
import { EVENTS } from './utils/branding'
import { sync_electron_locale } from './i18n'

// Choose router based on runtime environment
const is_electron = typeof window !== `undefined` && window.electronAPI?.native_inference
const Router = is_electron ? HashRouter : BrowserRouter

// Opt in to v7 behaviour to suppress future flag warnings
const router_future = { v7_startTransition: true, v7_relativeSplatPath: true }

/**
 * Root application component
 * Sets up providers: Router, Theme, QueryParams, Toasts
 * @returns {JSX.Element}
 */
export default function App() {

    const { theme } = use_theme()

    // Sync language from Electron system locale on first load
    useEffect( () => {
        sync_electron_locale() 
    }, [] )

    // Register global keyboard shortcuts
    useEffect( () => {

        return register_shortcuts( {
            new_chat: () => window.dispatchEvent( new CustomEvent( EVENTS.new_chat ) ),
            toggle_sidebar: () => window.dispatchEvent( new CustomEvent( EVENTS.toggle_sidebar ) ),
            open_settings: () => window.dispatchEvent( new CustomEvent( EVENTS.open_settings ) ),
            close_modal: () => window.dispatchEvent( new CustomEvent( EVENTS.close_modal ) ),
            stop_generation: () => window.dispatchEvent( new CustomEvent( EVENTS.stop_generation ) ),
        } )

    }, [] )

    return <ThemeProvider theme={ theme }>
        <GlobalStyle />
        <ErrorBoundary>
            <Router future={ router_future }>
                <QueryParamProvider adapter={ ReactRouter6Adapter }>
                    <DesktopAppBanner />
                    <Routes />
                    <Toaster
                        position="bottom-center"
                        toastOptions={ {
                            duration: 3000,
                            style: {
                                background: theme.colors.surface,
                                color: theme.colors.text,
                                border: `1px solid ${ theme.colors.border }`,
                            },
                        } }
                    />
                </QueryParamProvider>
            </Router>
        </ErrorBoundary>
    </ThemeProvider>

}
