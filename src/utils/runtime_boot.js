/**
 * "The inference runtime cannot start in this browser", found out before a download.
 *
 * WebKit before Safari 17 (iOS 16) sends every function that uses SIMD through
 * its optimising compiler on first call. The wasm32 runtime's static
 * constructors are one 336 KB function with SIMD moves in it: compiling it
 * never finishes, so the worker hangs before it reads a model. No error is
 * thrown; only a watchdog can tell.
 *
 * The picker's speed probe boots the runtime on a weightless model anyway, so
 * it carries the watchdog. A failure is remembered for the session: every
 * further attempt would hang another worker.
 */

import { EVENTS, storage_key } from './branding'

// A healthy boot takes 0.2–3 s (desktop to phone) once its files are here; a wrong
// "cannot start" locks a working browser out for the session, so stay well clear of that
export const RUNTIME_BOOT_TIMEOUT_MS = 30_000

// Safari 17 ended the hang, but still compiles those functions on first call:
// a 2016 dual-core MacBook on 17.6 takes 30–60 s to start a model it then chats
// with. On engines past the hang the watchdog is only a backstop.
export const SLOW_BOOT_TIMEOUT_MS = 180_000

/** How long a boot may take here: `URL.canParse` shipped with Safari 17 */
export const runtime_boot_timeout_ms = () => typeof URL.canParse === `function` ? SLOW_BOOT_TIMEOUT_MS : RUNTIME_BOOT_TIMEOUT_MS

const FAILED_KEY = storage_key( `runtime_boot_failed` )

export class RuntimeBootError extends Error {
    constructor() {
        super( `The inference runtime did not start in this browser` )
        this.name = `RuntimeBootError`
    }
}

/**
 * `boot`, rejected with RuntimeBootError once it outlasts the watchdog
 * @template T
 * @param {Promise<T>} boot - A runtime starting up
 * @param {number} [timeout_ms]
 * @returns {Promise<T>}
 */
export const with_boot_watchdog = ( boot, timeout_ms = runtime_boot_timeout_ms() ) => {

    let timeout_id
    const watchdog = new Promise( ( _, reject ) => {
        timeout_id = setTimeout( () => reject( new RuntimeBootError() ), timeout_ms )
    } )
    return Promise.race( [ boot, watchdog ] ).finally( () => clearTimeout( timeout_id ) )

}

/** Did the runtime fail to start earlier in this session? */
export const runtime_boot_failed = () => {
    try {
        return globalThis.sessionStorage?.getItem( FAILED_KEY ) === `1`
    } catch {
        return false
    }
}

/** Remember the failure for this session and tell open pages */
export const record_runtime_boot_failure = () => {
    try {
        globalThis.sessionStorage?.setItem( FAILED_KEY, `1` )
    } catch { /* storage blocked: this page still learns through the event */ }
    globalThis.dispatchEvent?.( new CustomEvent( EVENTS.runtime_boot_failed ) )
}
