/**
 * Speed mode persistence and the once-per-session speed tip.
 *
 * - Mode: the user's last Smarter / Balanced / Faster choice, shared by the picker and chat
 * - Tip: at most one inline "switch model?" offer per session; never again once disabled
 */
import { storage_key } from './branding'
import { DEFAULT_PREFERENCES, SPEED_MODES } from './model_catalog'

const MODE_KEY = storage_key( `speed_mode` )
const TIP_KEY = storage_key( `speed_tip_message` )

// Replies slower than this get a "faster model?" offer, faster than FAST a "smarter model?" one
export const SLOW_TIP_SPEED = 2.5
export const FAST_TIP_SPEED = 20

// A "faster" offer must be at least this many times the measured reply speed
export const MIN_TIP_SPEEDUP = 1.5

// Storage can throw in locked-down browsers; losing a preference is harmless
const safely = ( fn, fallback ) => {
    try {
        return fn()
    } catch {
        return fallback
    }
}

/** @returns {'better'|'balanced'|'faster'} */
export const read_speed_mode = () => {
    const stored = safely( () => localStorage.getItem( MODE_KEY ) )
    return SPEED_MODES.includes( stored ) ? stored : DEFAULT_PREFERENCES.priority
}

/** @param {'better'|'balanced'|'faster'} mode */
export const write_speed_mode = mode => safely( () => localStorage.setItem( MODE_KEY, mode ) )

/**
 * The one message this session's tip belongs to. Null until a tip shows;
 * `dismissed` once closed, so no later reply gets one either.
 * @returns {string|null}
 */
export const read_tip_message = () => safely( () => sessionStorage.getItem( TIP_KEY ), null )

/** @param {string} message_id - Or `dismissed` */
export const write_tip_message = message_id => safely( () => sessionStorage.setItem( TIP_KEY, message_id ) )

/**
 * Which way a reply's speed suggests moving, if any
 * @param {number} tokens_per_second
 * @returns {'faster'|'better'|null} The mode worth offering
 */
export const tip_direction = tokens_per_second =>
    !tokens_per_second ? null
        : tokens_per_second < SLOW_TIP_SPEED ? `faster`
            : tokens_per_second > FAST_TIP_SPEED ? `better`
                : null
