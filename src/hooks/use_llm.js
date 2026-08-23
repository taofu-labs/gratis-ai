import { useCallback } from 'react'
import use_llm_store from '../stores/llm_store'

/**
 * React hook wrapping the shared Zustand LLM store.
 * Thin wrapper that preserves the original return API while
 * delegating all state and logic to the module-scoped store.
 *
 * @returns {Object} LLM hook state and actions
 */
export default function use_llm() {

    const is_loading = use_llm_store( ( s ) => s.is_loading )
    const is_generating = use_llm_store( ( s ) => s.is_generating )
    const is_endpoint_warming = use_llm_store( ( s ) => s.is_endpoint_warming )
    const loaded_model_id = use_llm_store( ( s ) => s.loaded_model_id )
    const load_status = use_llm_store( ( s ) => s.load_status )
    const stats = use_llm_store( ( s ) => s.stats )
    const error = use_llm_store( ( s ) => s.error )

    // Actions — stable references from the store
    const store_load = use_llm_store( ( s ) => s.load_model )
    const store_stream = use_llm_store( ( s ) => s.chat_stream )
    const store_abort = use_llm_store( ( s ) => s.abort )
    const store_unload = use_llm_store( ( s ) => s.unload_model )
    const store_is_ready = use_llm_store( ( s ) => s.is_ready )

    // Wrap in useCallback for consumers that include these in dependency arrays
    const load_model = useCallback( ( id, on_progress ) => store_load( id, on_progress ), [ store_load ] )
    const chat_stream = useCallback( ( msgs, opts, on_token ) => store_stream( msgs, opts, on_token ), [ store_stream ] )
    const abort = useCallback( () => store_abort(), [ store_abort ] )
    const unload_model = useCallback( () => store_unload(), [ store_unload ] )
    const is_ready = useCallback( () => store_is_ready(), [ store_is_ready ] )

    return {
        load_model,
        chat_stream,
        abort,
        unload_model,
        is_ready,
        is_loading,
        is_generating,
        is_endpoint_warming,
        loaded_model_id,
        load_status,
        stats,
        error,
    }

}
