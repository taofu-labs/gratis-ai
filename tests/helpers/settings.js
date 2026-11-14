import { loadEnv } from 'vite'

// App settings live in localStorage as `<slug>:settings:<key>`, slug =
// lowercased VITE_APP_NAME (src/utils/branding.js). Derived from the same env
// the app builds with, so a rebrand can't silently turn test seeds into no-ops
const { VITE_APP_NAME = `gratisAI` } = loadEnv( `production`, process.cwd(), `VITE_` )
const slug = VITE_APP_NAME.toLowerCase()

/** localStorage prefix for settings, e.g. `gratis:settings:` */
export const SETTINGS_PREFIX = `${ slug }:settings:`

/** Custom event fired on `window` when a setting changes */
export const SETTINGS_EVENT = `${ slug }:settings-changed`

/**
 * Full localStorage key for a setting
 * @param {string} key - Setting name, e.g. `hf_token`
 * @returns {string} e.g. `gratis:settings:hf_token`
 */
export const setting_key = key => `${ SETTINGS_PREFIX }${ key }`

/**
 * Seed settings before any page script runs (every navigation)
 * @param {import('@playwright/test').Page|import('@playwright/test').BrowserContext} target
 * @param {Object<string, *>} settings - Setting name → value (strings stored as-is, rest JSON)
 * @returns {Promise<void>}
 */
export const seed_settings = ( target, settings ) => {

    const entries = Object.entries( settings ).map( ( [ key, value ] ) => [
        setting_key( key ),
        typeof value === `string` ? value : JSON.stringify( value ),
    ] )

    return target.addInitScript( entries => {
        for( const [ key, value ] of entries ) localStorage.setItem( key, value )
    }, entries )

}
