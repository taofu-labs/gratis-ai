/**
 * Centralised branding — single source of truth for app name,
 * storage prefixes, event names, and derived constants.
 *
 * Every branded string in the codebase imports from here.
 * To rebrand, change VITE_APP_NAME in .env — everything else follows.
 */

const raw = import.meta.env.VITE_APP_NAME || `gratisAI`
const slug = raw.toLowerCase()

// ── Display ──────────────────────────────────────────────────────

/** The app name exactly as it should appear in the UI */
export const DISPLAY_NAME = raw

/** App version from package.json (injected at build time) */
export const APP_VERSION = typeof __APP_VERSION__ !== `undefined` ? __APP_VERSION__ : `dev`

// ── Storage ──────────────────────────────────────────────────────

/** Generic prefix for all app-owned keys: `gratisai:` */
export const APP_PREFIX = `${ slug }:`

/** localStorage prefix for settings: `gratisai:settings:` */
export const STORAGE_PREFIX = `${ slug }:settings:`

/** IndexedDB database name */
export const DB_NAME = `${ slug }-db`

/**
 * Build a full localStorage key for a setting.
 * @param {string} key - Setting name (e.g. `theme`, `active_model_id`)
 * @returns {string} Fully qualified key (e.g. `gratisai:settings:theme`)
 */
export const storage_key = ( key ) => `${ STORAGE_PREFIX }${ key }`

// ── Custom events ────────────────────────────────────────────────

/** Named custom events dispatched on `window` */
export const EVENTS = {
    new_chat:        `${ slug }:new-chat`,
    toggle_sidebar:  `${ slug }:toggle-sidebar`,
    open_settings:   `${ slug }:open-settings`,
    close_modal:     `${ slug }:close-modal`,
    stop_generation: `${ slug }:stop-generation`,
    settings_changed: `${ slug }:settings-changed`,
}
