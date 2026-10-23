import { storage_key } from './branding'
import { SPEED_REFERENCE_ID } from './speed_probe'

/**
 * How fast this device decodes, learned locally:
 * - speed ratio: this device ÷ the reference machine that measured the
 *   catalog's `browser_tps`. Seeded by the speed probe, refined by real replies.
 * - decode bandwidth: per runtime, for models without a reference speed
 *   (Electron, custom GGUFs). Refined by real replies.
 */
const BANDWIDTH_KEY = storage_key( `decode_bandwidth` )
const RATIO_KEY = storage_key( `speed_ratio` )

// Short replies are mostly noise; newer samples keep at least a 1 / 10 say
const MIN_TOKENS = 32
const MAX_WEIGHT_SAMPLES = 10

const read = key => {
    try {
        return JSON.parse( localStorage.getItem( key ) ) || {}
    } catch {
        return {}
    }
}

const write = ( key, value ) => {
    try {
        localStorage.setItem( key, JSON.stringify( value ) )
    } catch { /* storage blocked: keep the static guess */ }
}

/** Running average where the newest sample keeps at least a 1 / 10 say. */
const fold = ( { value: average, n = 0 } = {}, value ) => ( {
    value: average === undefined ? value : average + ( value - average ) / Math.min( n + 1, MAX_WEIGHT_SAMPLES ),
    n: n + 1,
} )

// A backgrounded tab is throttled: its speed says nothing about the device
const usable_reply = ( value, tokens ) => value > 0 && tokens >= MIN_TOKENS
    && !( typeof document !== `undefined` && document.hidden )

/**
 * @param {'browser'|'electron'} runtime
 * @returns {number|null} Learned GB/s, or null before the first usable reply
 */
export const calibrated_bandwidth_gbs = runtime => read( BANDWIDTH_KEY )[ runtime ]?.gbs ?? null

/**
 * Fold one reply's implied bandwidth into the running average
 * @param {'browser'|'electron'} runtime
 * @param {number} gbs - From `implied_bandwidth_gbs`
 * @param {number} tokens - Tokens the reply generated
 */
export const record_bandwidth_sample = ( runtime, gbs, tokens ) => {

    if( !usable_reply( gbs, tokens ) ) return

    const samples = read( BANDWIDTH_KEY )
    const { value, n } = fold( samples[ runtime ] && { value: samples[ runtime ].gbs, n: samples[ runtime ].n }, gbs )
    write( BANDWIDTH_KEY, { ...samples, [ runtime ]: { gbs: value, n } } )

}

// Ratios measured against an older reference table mean nothing now
const current_ratio = () => {
    const stored = read( RATIO_KEY )
    return stored.reference === SPEED_REFERENCE_ID ? stored : {}
}

/** @returns {number|null} This browser's speed relative to the reference machine */
export const calibrated_speed_ratio = () => current_ratio().ratio ?? null

/** @returns {boolean} Whether the speed probe already ran against the current reference */
export const has_speed_probe = () => current_ratio().probe === true

/**
 * Fold one speed ratio into the running average
 * @param {number} ratio - Measured ÷ reference tokens/second
 * @param {Object} [options]
 * @param {number} [options.tokens] - Reply length; omit for the probe
 * @param {boolean} [options.probe] - Sample comes from the speed probe
 */
export const record_speed_ratio = ( ratio, { tokens = MIN_TOKENS, probe = false } = {} ) => {

    if( !usable_reply( ratio, tokens ) ) return

    const stored = current_ratio()
    const { value, n } = fold( stored.ratio === undefined ? undefined : { value: stored.ratio, n: stored.n }, ratio )
    write( RATIO_KEY, { reference: SPEED_REFERENCE_ID, ratio: value, n, probe: stored.probe || probe } )

}
