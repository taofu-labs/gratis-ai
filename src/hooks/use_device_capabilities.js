import { useState, useEffect } from 'react'
import use_llm_store from '../stores/llm_store'
import { EVENTS } from '../utils/branding'
import {
    BROWSER_RAM_OVERRIDE_KEY,
    detect_capabilities,
    estimate_max_model_bytes,
    get_initial_browser_capabilities,
    measure_wasm_memory_grant,
    probe_capabilities_gpu_memory,
    with_latest_grant,
} from '../utils/device_detection'

/**
 * Hook that detects device capabilities on mount
 * @param {Object} [options]
 * @param {boolean} [options.inspect] - Re-measure the memory grant now (up to 10 s), while inference is idle
 * @returns {{ capabilities: import('../utils/device_detection').DeviceCapabilities | null, max_model_bytes: number, is_detecting: boolean, is_inspecting: boolean }}
 */
export default function use_device_capabilities( { inspect = false } = {} ) {

    const [ capabilities, set_capabilities ] = useState( get_initial_browser_capabilities )
    const [ is_detecting, set_is_detecting ] = useState( true )
    const [ is_inspecting, set_is_inspecting ] = useState( inspect )
    const [ , set_ram_override_version ] = useState( 0 )
    const max_model_bytes = capabilities ? estimate_max_model_bytes( capabilities ) : 0

    useEffect( () => {

        const handle_change = ( { detail } ) => {
            if( detail?.key === BROWSER_RAM_OVERRIDE_KEY ) set_ram_override_version( version => version + 1 )
        }

        // A fresh grant measurement from any hook instance updates every budget
        const handle_measured = () => set_capabilities( with_latest_grant )

        window.addEventListener( EVENTS.settings_changed, handle_change )
        window.addEventListener( EVENTS.device_measured, handle_measured )
        return () => {
            window.removeEventListener( EVENTS.settings_changed, handle_change )
            window.removeEventListener( EVENTS.device_measured, handle_measured )
        }

    }, [] )

    // A loaded model holds memory of its own: measuring then would under-read
    // the device, so keep the last reading until inference is idle
    useEffect( () => {

        if( !inspect ) return
        let cancelled = false

        const llm = use_llm_store.getState()
        const busy = llm.is_loading || llm.is_generating || llm.loaded_model_id
        const measured = busy ? Promise.resolve() : measure_wasm_memory_grant()
        measured.finally( () => !cancelled && set_is_inspecting( false ) )

        return () => {
            cancelled = true
        }

    }, [ inspect ] )

    useEffect( () => {

        let cancelled = false

        detect_capabilities()
            .then( async result => {

                if( cancelled ) return

                set_capabilities( result )
                set_is_detecting( false )

                // Probe only while inference is idle. WllamaProvider can await
                // the same shared probe before a first model load. Busy hooks
                // may still consume an already-finished probe without allocating.
                const llm = use_llm_store.getState()
                const cached_only = !!( llm.is_loading || llm.is_generating || llm.loaded_model_id )

                const measured = await probe_capabilities_gpu_memory( result, { cached_only } )
                // A grant measured meanwhile (another hook) must survive this update
                if( !cancelled ) set_capabilities( with_latest_grant( measured ) )

            } )
            .catch( () => {
                if( !cancelled ) set_is_detecting( false )
            } )

        return () => {
            cancelled = true
        }

    }, [] )

    return { capabilities, max_model_bytes, is_detecting, is_inspecting }

}
