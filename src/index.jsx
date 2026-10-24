// Must stay first: the mobile apps install their native bridge before anything reads it
import './native/install'
import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/montserrat'
import '@fontsource-variable/nunito'
import './i18n'
import App from './App'
import './index.css'
import { subscribe_to_nodejs_console } from './utils/nodejs_console'
import { capture_install_prompt, reload_for_update, use_app_update_store, watch_for_updates } from './utils/app_update'

// Pipe Node.js console output into the browser DevTools (Electron only)
subscribe_to_nodejs_console()

const SERVICE_WORKER_RELOAD_DELAY = 1_000

capture_install_prompt()
watch_for_updates()

/**
 * Reloading during inference can lose an answer; reloading `/download` can
 * discard hours of model transfer progress. Wait until both are idle.
 * Typed text is stashed across the reload; attachments and a focused,
 * mid-sentence input are not interrupted.
 * @returns {Promise<boolean>}
 */
const has_active_browser_work = async () => {
    if( window.location.pathname.startsWith( `/download` ) ) return true
    if( document.querySelector( `[data-testid="draft-attachments"]` ) ) return true

    const { activeElement: focused } = document
    if( focused?.matches?.( `textarea, input[type="text"]` ) && focused.value?.trim() ) return true

    // Keep the provider graph out of the initial bundle. Service-worker
    // replacement is rare, so inspect the store only when it happens.
    try {
        const { default: use_llm_store } = await import( `./stores/llm_store` )
        const { is_generating, is_loading } = use_llm_store.getState()
        return is_generating || is_loading
    } catch {
        // A newly activated worker may have removed this page's old hashed
        // chunk. Reloading is the only recovery and fetches the current graph.
        return false
    }
}

// A new document is required for changed COOP/COEP headers to take effect.
// The initial install has no controller, so first-time visitors do not reload.
if( navigator.serviceWorker?.controller ) {

    let is_reloading = false

    const reload_when_idle = async () => {
        if( is_reloading ) return

        // Busy: flag the waiting update (Settings can apply it now) and retry when idle
        if( await has_active_browser_work() ) {
            use_app_update_store.setState( { update_ready: true } )
            window.setTimeout( reload_when_idle, SERVICE_WORKER_RELOAD_DELAY )
            return
        }

        is_reloading = true
        reload_for_update()
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
