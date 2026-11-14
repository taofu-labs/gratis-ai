import { useEffect, useState } from 'react'
import { EVENTS } from '../utils/branding'
import { runtime_boot_failed } from '../utils/runtime_boot'

/**
 * Whether the inference runtime failed to start in this browser (this session)
 * @returns {boolean} Turns true the moment the picker's probe finds out
 */
export default function use_runtime_boot_failed() {

    const [ failed, set_failed ] = useState( runtime_boot_failed )

    useEffect( () => {
        const on_failure = () => set_failed( true )
        window.addEventListener( EVENTS.runtime_boot_failed, on_failure )
        return () => window.removeEventListener( EVENTS.runtime_boot_failed, on_failure )
    }, [] )

    return failed

}
