import React from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import App from './App'
import './index.css'
import { subscribe_to_nodejs_console } from './utils/nodejs_console'

// Pipe Node.js console output into the browser DevTools (Electron only)
subscribe_to_nodejs_console()

// Mount the React application
const root = createRoot( document.getElementById( `root` ) )
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
)
