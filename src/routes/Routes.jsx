import { lazy, Suspense } from 'react'
import { Routes as RouterRoutes, Route } from 'react-router-dom'
import { storage_key } from '../utils/branding'

// Warm page chunks once the browser is idle. Calling the import itself reuses
// the bundler's own chunk resolution, so it works for every build format and
// in Electron, unlike parsing chunk paths out of the function source.
const schedule_idle = globalThis.requestIdleCallback?.bind( globalThis ) || ( fn => setTimeout( fn, 1_500 ) )
const preload = load => {
    schedule_idle( () => load().catch( () => {} ) )
    return load
}

// Lazy load all pages for code splitting, preloaded when idle
const WelcomePage = lazy( preload( () => import( '../components/pages/WelcomePage' ) ) )
const HomePage = lazy( preload( () => import( '../components/pages/HomePage' ) ) )
const ModelSelectPage = lazy( preload( () => import( '../components/pages/ModelSelectPage' ) ) )
const DownloadPage = lazy( preload( () => import( '../components/pages/DownloadPage' ) ) )
const ChatPage = lazy( preload( () => import( '../components/pages/ChatPage' ) ) )
const GetAppPage = lazy( preload( () => import( '../components/pages/GetAppPage' ) ) )
const LegalPage = lazy( preload( () => import( '../components/pages/LegalPage' ) ) )
const NotFoundPage = lazy( preload( () => import( '../components/pages/NotFoundPage' ) ) )

/**
 * Pick the right landing page: returning users get the search home,
 * first-time users get the onboarding welcome.
 */
function LandingPage( props ) {
    const has_model = !!localStorage.getItem( storage_key( `active_model_id` ) )
    return has_model ? <HomePage /> : <WelcomePage { ...props } />
}

/**
 * Application route definitions
 * @returns {JSX.Element}
 */
export default function Routes() {

    return <Suspense fallback={ <div /> }>
        <RouterRoutes>
            <Route path="/" element={ <LandingPage /> } />
            <Route path="/select-model" element={ <ModelSelectPage /> } />
            <Route path="/download" element={ <DownloadPage /> } />
            <Route path="/chat/:id?" element={ <ChatPage /> } />
            <Route path="/get-app" element={ <GetAppPage /> } />
            { [ `privacy`, `terms`, `support` ].map( page => <Route key={ page } path={ `/${ page }` } element={ <LegalPage /> } /> ) }
            <Route path="*" element={ <NotFoundPage /> } />
        </RouterRoutes>
    </Suspense>

}
