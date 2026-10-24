import { create } from 'zustand'
import { log } from 'mentie'
import { APP_PREFIX, EVENTS } from './branding'

const DRAFT_PREFIX = `${ APP_PREFIX }update_draft:`
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000

const is_electron = () => !!window.electronAPI?.native_inference

/** Running as an installed app (home screen, dock, or app window) */
export const is_standalone = () => window.matchMedia?.( `( display-mode: standalone )` ).matches
    || navigator.standalone === true

/** iOS browsers cannot prompt; installing goes through Share → Add to Home Screen */
export const is_ios = () => /iPhone|iPad|iPod/i.test( navigator.userAgent )
    || /Macintosh/.test( navigator.userAgent ) && navigator.maxTouchPoints > 1

/**
 * PWA lifecycle state
 * - update_ready: a new version is active but this tab is busy, so it waits
 * - install_prompt: the deferred `beforeinstallprompt` event, null when unavailable
 */
export const use_app_update_store = create( () => ( {
    update_ready: false,
    install_prompt: null,
} ) )

// ── Drafts that survive an update reload ─────────────────────────

/**
 * Keep unsent text across the reload an update triggers. A manual reload
 * still starts clean: only reload_for_update() stashes.
 * @param {string} key - Which input the draft belongs to
 * @param {string} text
 */
export const stash_update_draft = ( key, text ) => {
    try {
        if( text.trim() ) sessionStorage.setItem( `${ DRAFT_PREFIX }${ key }`, text )
    } catch {
        // Storage blocked: the draft is lost, the update still applies
    }
}

/**
 * Read a stashed draft. Pure, so it is safe in a state initialiser.
 * @param {string} key
 * @returns {string}
 */
export const read_update_draft = key => {
    try {
        return sessionStorage.getItem( `${ DRAFT_PREFIX }${ key }` ) || ``
    } catch {
        return ``
    }
}

/**
 * Forget a stashed draft once restored, so a later manual reload starts clean
 * @param {string} key
 */
export const forget_update_draft = key => {
    try {
        sessionStorage.removeItem( `${ DRAFT_PREFIX }${ key }` )
    } catch {
        // Nothing stashed can be read either
    }
}

// ── Reloading ────────────────────────────────────────────────────

/** Let inputs stash their drafts, then load the new version */
export const reload_for_update = () => {
    window.dispatchEvent( new CustomEvent( EVENTS.before_update_reload ) )
    window.location.reload()
}

/**
 * The manual escape hatch: drop every service worker so the next load comes
 * straight from the network, then reload. Models live in OPFS and stay.
 * Offline it does nothing: without the worker the app could not start again.
 * @returns {Promise<boolean>} False when the network is unreachable
 */
export const reinstall_app = async () => {

    try {
        await fetch( `/`, { method: `HEAD`, cache: `no-store` } ).then( response => {
            if( !response.ok ) throw new Error( `HTTP ${ response.status }` )
        } )
    } catch ( error ) {
        log.warn( `[pwa] Not reinstalling while offline:`, error?.message )
        return false
    }

    try {
        const registrations = await navigator.serviceWorker?.getRegistrations() || []
        await Promise.all( registrations.map( registration => registration.unregister() ) )
    } catch ( error ) {
        log.warn( `[pwa] Could not unregister service workers:`, error?.message )
    }
    reload_for_update()
    return true

}

// ── Background checks ────────────────────────────────────────────

/**
 * Browsers only look for a new service worker on navigation, and an
 * installed app may never navigate. Check hourly and whenever it comes back
 * into view; the autoUpdate worker activates itself once found.
 */
export const watch_for_updates = () => {

    if( !navigator.serviceWorker || is_electron() ) return

    const check = async () => {
        try {
            const registration = await navigator.serviceWorker.getRegistration()
            await registration?.update()
        } catch ( error ) {
            log.info( `[pwa] Update check failed:`, error?.message )
        }
    }

    window.setInterval( check, UPDATE_CHECK_INTERVAL )
    document.addEventListener( `visibilitychange`, () => {
        if( document.visibilityState === `visible` ) check()
    } )

}

/**
 * Capture the install prompt as early as possible: Chrome fires it once,
 * often before React mounts.
 */
export const capture_install_prompt = () => {

    if( is_electron() ) return

    window.addEventListener( `beforeinstallprompt`, event => {
        event.preventDefault()
        use_app_update_store.setState( { install_prompt: event } )
    } )

    window.addEventListener( `appinstalled`, () => use_app_update_store.setState( { install_prompt: null } ) )

}
