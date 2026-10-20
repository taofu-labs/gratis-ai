import { useEffect, useState } from 'react'
import use_llm_store from '../stores/llm_store'

/**
 * Live model-load status: the current stage key (pages namespace) and the
 * seconds elapsed, ticking once per second while a load is in flight.
 *
 * wllama64's loadModel() exposes no byte progress, so stages plus elapsed
 * time are the most honest signal available.
 *
 * @returns {{ is_loading: boolean, stage_key: string|null, elapsed_seconds: number, loading_model_id: string|null }}
 */
export default function use_model_load_status() {

    const is_loading = use_llm_store( s => s.is_loading )
    const stage_key = use_llm_store( s => s.load_stage )
    const started_at = use_llm_store( s => s.load_started_at )
    const loading_model_id = use_llm_store( s => s._loading_model_id )
    const [ now, set_now ] = useState( () => Date.now() )

    useEffect( () => {
        if( !is_loading ) return
        set_now( Date.now() )
        const timer = setInterval( () => set_now( Date.now() ), 1_000 )
        return () => clearInterval( timer )
    }, [ is_loading ] )

    const elapsed_seconds = is_loading && started_at ? Math.max( 0, Math.floor( ( now - started_at ) / 1000 ) ) : 0

    return { is_loading, stage_key, elapsed_seconds, loading_model_id }

}
