import { useState, useCallback, useRef, useEffect } from 'react'
import {
    can_probe_network,
    get_speed_estimate,
    probe_download_speed,
    record_speed_sample,
} from '../utils/network_speed'

/**
 * Measure the real model-download host with a bounded streaming request.
 * Actual prior model downloads win over short probe samples.
 *
 * @param {string|null} target_url
 * @returns {{speed_bps: number|null, speed_mbps: number|null, source: string|null, is_estimating: boolean, error: Error|null, run_estimate: Function}}
 */
export default function use_speed_estimate( target_url ) {

    const [ speed_bps, set_speed_bps ] = useState( null )
    const [ source, set_source ] = useState( null )
    const [ is_estimating, set_estimating ] = useState( false )
    const [ error, set_error ] = useState( null )
    const abort_ref = useRef( null )
    const request_id_ref = useRef( 0 )

    useEffect( () => {

        abort_ref.current?.abort()
        request_id_ref.current++

        const cached = target_url ? get_speed_estimate( target_url ) : null
        set_speed_bps( cached?.bps || null )
        set_source( cached?.source || null )
        set_error( null )
        set_estimating( false )

    }, [ target_url ] )

    const run_estimate = useCallback( async () => {

        if( !target_url ) return

        const cached = get_speed_estimate( target_url )
        if( cached ) {
            set_speed_bps( cached.bps )
            set_source( cached.source )
            return
        }

        if( !can_probe_network() ) {
            set_error( new Error( navigator.onLine === false
                ? `Offline`
                : `Data-saving mode enabled` ) )
            return
        }

        abort_ref.current?.abort()
        const controller = new AbortController()
        abort_ref.current = controller
        const request_id = ++request_id_ref.current

        set_estimating( true )
        set_error( null )

        try {
            const sample = await probe_download_speed( target_url, { signal: controller.signal } )
            if( request_id !== request_id_ref.current ) return

            record_speed_sample( target_url, sample.bps, `probe` )
            const conservative = get_speed_estimate( target_url )
            set_speed_bps( conservative?.bps || sample.bps )
            set_source( conservative?.source || `probe` )
        } catch ( measurement_error ) {
            if( measurement_error.name !== `AbortError` && request_id === request_id_ref.current ) {
                set_error( measurement_error )
            }
        } finally {
            if( request_id === request_id_ref.current ) set_estimating( false )
        }

    }, [ target_url ] )

    useEffect( () => () => abort_ref.current?.abort(), [] )

    return {
        speed_bps,
        speed_mbps: speed_bps ? speed_bps * 8 / 1_000_000 : null,
        source,
        is_estimating,
        error,
        run_estimate,
    }

}
