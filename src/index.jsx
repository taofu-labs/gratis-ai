import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/montserrat'
import '@fontsource-variable/nunito'
import './i18n'
import App from './App'
import './index.css'
import { subscribe_to_nodejs_console } from './utils/nodejs_console'

// Pipe Node.js console output into the browser DevTools (Electron only)
subscribe_to_nodejs_console()

const SERVICE_WORKER_RELOAD_DELAY = 1_000

/**
 * Reloading during inference can lose an answer; reloading `/download` can
 * discard hours of model transfer progress. Wait until both are idle.
 * @returns {Promise<boolean>}
 */
const has_active_browser_work = async () => {
    if( window.location.pathname === `/download` ) return true

    // Keep the provider graph out of the initial bundle. Service-worker
    // replacement is rare, so inspect the store only when it happens.
    const { default: use_llm_store } = await import( `./stores/llm_store` )
    const { is_generating, is_loading } = use_llm_store.getState()
    return is_generating || is_loading
}

// A new document is required for changed COOP/COEP headers to take effect.
// The initial install has no controller, so first-time visitors do not reload.
if( navigator.serviceWorker?.controller ) {

    let is_reloading = false

    const reload_when_idle = async () => {
        if( is_reloading ) return

        if( await has_active_browser_work() ) {
            window.setTimeout( reload_when_idle, SERVICE_WORKER_RELOAD_DELAY )
            return
        }

        is_reloading = true
        window.location.reload()
    }

    navigator.serviceWorker.addEventListener( `controllerchange`, reload_when_idle )

}

// Mount the React application
const root = createRoot( document.getElementById( `root` ) )
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
)
