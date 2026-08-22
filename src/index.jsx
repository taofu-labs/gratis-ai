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

// Reload controlled web clients when a future service worker takes over.
// The initial install has no controller, so first-time visitors do not reload.
if( navigator.serviceWorker?.controller ) {

    let is_reloading = false

    navigator.serviceWorker.addEventListener( `controllerchange`, () => {
        if( is_reloading ) return
        is_reloading = true
        window.location.reload()
    } )

}

// Mount the React application
const root = createRoot( document.getElementById( `root` ) )
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
)
