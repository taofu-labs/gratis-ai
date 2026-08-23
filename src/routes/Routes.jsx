import { lazy, Suspense } from 'react'
import { Routes as RouterRoutes, Route } from 'react-router-dom'
import { prefetch } from 'less-lazy'
import { storage_key } from '../utils/branding'

// Prefetching injects <link rel="prefetch"> tags — a network optimisation that has
// zero value in Electron where assets load from disk instantly. Worse, less-lazy
// resolves chunk paths relative to the HTML document instead of the assets dir,
// causing ERR_FILE_NOT_FOUND for every lazy-loaded chunk.
const is_electron = typeof window !== `undefined` && window.electronAPI?.native_inference
const maybe_prefetch = is_electron ? fn => fn : prefetch

// Lazy load all pages with prefetching for code splitting (web only)
const WelcomePage = lazy( maybe_prefetch( () => import( '../components/pages/WelcomePage' ) ) )
const HomePage = lazy( maybe_prefetch( () => import( '../components/pages/HomePage' ) ) )
const ModelSelectPage = lazy( maybe_prefetch( () => import( '../components/pages/ModelSelectPage' ) ) )
const DownloadPage = lazy( maybe_prefetch( () => import( '../components/pages/DownloadPage' ) ) )
const ChatPage = lazy( maybe_prefetch( () => import( '../components/pages/ChatPage' ) ) )
const GetAppPage = lazy( maybe_prefetch( () => import( '../components/pages/GetAppPage' ) ) )
const NotFoundPage = lazy( maybe_prefetch( () => import( '../components/pages/NotFoundPage' ) ) )

/**
 * Pick the right landing page: returning users get the search home,
 * first-time users get the onboarding welcome.
 */
function LandingPage() {
    const has_model = !!localStorage.getItem( storage_key( `active_model_id` ) )
    return has_model ? <HomePage /> : <WelcomePage />
}

/**
 * Application route definitions
 * @param {Object} props
 * @param {string} props.theme_preference - Current theme preference
 * @param {string} props.theme_mode - Resolved theme mode
 * @param {Function} props.on_theme_toggle - Handler for theme cycling
 * @returns {JSX.Element}
 */
export default function Routes( { theme_preference, theme_mode, on_theme_toggle } ) {

    // Shared props passed to pages that use AppLayout
    const layout_props = { theme_preference, theme_mode, on_theme_toggle }

    return <Suspense fallback={ <div /> }>
        <RouterRoutes>
            <Route path="/" element={ <LandingPage /> } />
            <Route path="/select-model" element={ <ModelSelectPage /> } />
            <Route path="/download" element={ <DownloadPage /> } />
            <Route path="/chat/:id?" element={ <ChatPage { ...layout_props } /> } />
            <Route path="/get-app" element={ <GetAppPage /> } />
            <Route path="*" element={ <NotFoundPage /> } />
        </RouterRoutes>
    </Suspense>

}
