import { useEffect, useState } from 'react'
import { Wllama } from 'wllama64'
import { log } from 'mentie'
import { storage_key } from '../utils/branding'
import { measure_probe_tps, REFERENCE_PROBE_TPS } from '../utils/speed_probe'
import { calibrated_speed_ratio, has_speed_probe, record_speed_ratio } from '../utils/speed_calibration'
import { COMPAT_PATHS, CONFIG_PATHS } from '../utils/wllama_paths'
import use_llm_store from '../stores/llm_store'

// Automated browsers skip the probe (it would compete with test inference)
// unless a test opts in with this localStorage flag
const FORCE_KEY = storage_key( `force_speed_probe` )

const probe_allowed = () => {
    try {
        return !globalThis.navigator?.webdriver || localStorage.getItem( FORCE_KEY ) === `1`
    } catch {
        return !globalThis.navigator?.webdriver
    }
}

// A real model loading or loaded: the probe would compete with it
const runtime_busy = () => {
    const { loaded_model_id, is_loading } = use_llm_store.getState()
    return !!( loaded_model_id || is_loading )
}

// One probe at a time, shared by every picker mount; has_speed_probe() stops repeats,
// so a failed or hidden-tab run retries on the next idle picker
let running = null

const run_probe = () => running ||= ( async () => {

    // Same runtime choice as the provider: Memory64, or wasm32 on Firefox/Safari
    const wllama = new Wllama( CONFIG_PATHS, { allowOffline: true, suppressNativeLog: true } )
    wllama.setCompat( COMPAT_PATHS, `firefox_safari` )

    const started = performance.now()
    const tps = await measure_probe_tps( wllama, runtime_busy )
    record_speed_ratio( tps / REFERENCE_PROBE_TPS, { probe: true } )
    log.info( `[speed_probe] ${ tps.toFixed( 2 ) } t/s = ${ ( tps / REFERENCE_PROBE_TPS ).toFixed( 2 ) }× reference, ${ Math.round( performance.now() - started ) } ms` )

} )()
    .catch( error => log.warn( `[speed_probe] failed; keeping the default speed guess:`, error ) )
    .finally( () => running = null )

/**
 * Measure this browser's decode speed once (about 10 s, ~11 MB header, no
 * weights), so the picker can scale the catalog's reference speeds to it.
 *
 * @param {boolean} enabled - Browser runtime, idle: no model loading or loaded
 * @returns {number|null} Current speed ratio; changes once the probe finishes
 */
export default function use_device_speed_probe( enabled ) {

    const [ ratio, set_ratio ] = useState( calibrated_speed_ratio )

    useEffect( () => {

        // A probe that finished while this picker was busy still counts
        set_ratio( calibrated_speed_ratio() )
        if( !enabled || has_speed_probe() || !probe_allowed() ) return

        let live = true
        run_probe().then( () => live && set_ratio( calibrated_speed_ratio() ) )
        return () => {
            live = false
        }

    }, [ enabled ] )

    return ratio

}
