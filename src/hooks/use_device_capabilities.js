import { useState, useEffect } from 'react'
import use_llm_store from '../stores/llm_store'
import {
    detect_capabilities,
    estimate_max_model_bytes,
    get_initial_browser_capabilities,
    probe_capabilities_gpu_memory,
} from '../utils/device_detection'

/**
 * Hook that detects device capabilities on mount
 * @returns {{ capabilities: import('../utils/device_detection').DeviceCapabilities | null, max_model_bytes: number, is_detecting: boolean }}
 */
export default function use_device_capabilities() {

    const [ capabilities, set_capabilities ] = useState( get_initial_browser_capabilities )
    const [ is_detecting, set_is_detecting ] = useState( true )
    const max_model_bytes = capabilities ? estimate_max_model_bytes( capabilities ) : 0

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
                if( !cancelled ) set_capabilities( measured )

            } )
            .catch( () => {
                if( !cancelled ) set_is_detecting( false )
            } )

        return () => {
            cancelled = true
        }

    }, [] )

    return { capabilities, max_model_bytes, is_detecting }

}
