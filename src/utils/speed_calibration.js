import { storage_key } from './branding'

/**
 * Decode bandwidth learned from real replies on this device. The picker's
 * static per-device guess is only a starting point: each finished reply says
 * how fast this machine actually is, kept as a running average per runtime.
 */
const KEY = storage_key( `decode_bandwidth` )

// Short replies are mostly noise; newer samples keep at least a 1 / 10 say
const MIN_TOKENS = 32
const MAX_WEIGHT_SAMPLES = 10

const read = () => {
    try {
        return JSON.parse( localStorage.getItem( KEY ) ) || {}
    } catch {
        return {}
    }
}

/**
 * @param {'browser'|'electron'} runtime
 * @returns {number|null} Learned GB/s, or null before the first usable reply
 */
export const calibrated_bandwidth_gbs = runtime => read()[ runtime ]?.gbs ?? null

/**
 * Fold one reply's implied bandwidth into the running average
 * @param {'browser'|'electron'} runtime
 * @param {number} gbs - From `implied_bandwidth_gbs`
 * @param {number} tokens - Tokens the reply generated
 */
export const record_bandwidth_sample = ( runtime, gbs, tokens ) => {

    // A backgrounded tab is throttled: its speed says nothing about the device
    if( !( gbs > 0 ) || tokens < MIN_TOKENS ) return
    if( typeof document !== `undefined` && document.hidden ) return

    const samples = read()
    const { gbs: average = gbs, n = 0 } = samples[ runtime ] || {}
    const weight = 1 / Math.min( n + 1, MAX_WEIGHT_SAMPLES )
    samples[ runtime ] = { gbs: average + ( gbs - average ) * weight, n: n + 1 }

    try {
        localStorage.setItem( KEY, JSON.stringify( samples ) )
    } catch { /* storage blocked: keep the static guess */ }

}
