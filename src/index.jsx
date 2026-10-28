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
// A first visit's own install claims the page too: that takeover is not an
// update, so only later ones reload (a first visit may stay open for hours).
if( navigator.serviceWorker ) {

    let is_reloading = false
    let awaiting_first_claim = !navigator.serviceWorker.controller

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

    navigator.serviceWorker.addEventListener( `controllerchange`, () => {
        if( awaiting_first_claim ) {
            awaiting_first_claim = false
            return
        }
        reload_when_idle()
    } )

    // While an update waits, this page's lazily loaded chunks are gone from the
    // server. A failed one means the old version can't go on: move to the new one.
    window.addEventListener( `vite:preloadError`, event => {
        if( !use_app_update_store.getState().update_ready || is_reloading ) return
        event.preventDefault()
        is_reloading = true
        reload_for_update()
    } )

}

// Mount the React application
const root = createRoot( document.getElementById( `root` ) )
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
)
