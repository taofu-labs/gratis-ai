import { create } from 'zustand'
import { log } from 'mentie'
import { create_provider } from '../providers/factory'
import { storage_key } from '../utils/branding'

/**
 * Coalesce streamed text updates to one per animation frame. Re-rendering and
 * markdown parsing then scale with frames instead of tokens, which leaves the
 * CPU to the inference worker on low-core devices.
 * @param {Function} fn - Receiver of the latest arguments
 * @returns {Function} Throttled caller with a synchronous `flush()`
 */
const per_frame = fn => {

    let pending = null
    let frame = null

    const flush = () => {
        if( frame !== null ) cancelAnimationFrame( frame )
        frame = null
        if( !pending ) return
        const args = pending
        pending = null
        fn( ...args )
    }

    const call = ( ...args ) => {
        pending = args
        if( frame === null ) frame = requestAnimationFrame( flush )
    }

    call.flush = flush
    return call

}

/**
 * Shared LLM state store — singleton across all pages.
 *
 * Both HomePage (preload) and ChatPage (inference) share the same
 * provider instance and loading state, preventing duplicate model loads
 * when navigating between pages.
 */
const use_llm_store = create( ( set, get ) => ( {

    // ── State ────────────────────────────────────────────────────────

    is_loading: false,
    is_generating: false,
    is_endpoint_warming: false,
    loaded_model_id: null,
    stats: null,
    error: null,

    // { total, cache, processed, time_ms } while llama.cpp reads the prompt
    prompt_progress: null,

    // ── Internal (not consumed by UI) ────────────────────────────────

    _provider: null,
    _provider_type: null,
    _provider_promise: null,
    _load_promise: null,
    _loading_model_id: null,
    _stop_requested: false,
    _run: null,

    // ── Actions ──────────────────────────────────────────────────────

    /**
     * Ensure the provider is initialised (handles async creation).
     * Uses a shared promise so all concurrent callers get the same instance.
     *
     * Stale cloud-provider model IDs from earlier builds are cleared so users
     * land back on the local model picker.
     */
    ensure_provider: async ( model_id ) => {

        const state = get()
        const target_id = model_id || localStorage.getItem( storage_key( `active_model_id` ) ) || ``
        const target_type = `local`

        const current_type = state._provider_type

        // Gracefully handle stale cloud prefixes from previous versions
        if( target_id.startsWith( `runpod:` )
            || target_id.startsWith( `openrouter:` )
            || target_id.startsWith( `venice:` ) ) {
            log.warn( `[use_llm] Stale unsupported model prefix — clearing active model` )
            localStorage.removeItem( storage_key( `active_model_id` ) )
            throw new Error( `This model connection is no longer supported. Choose a local model to continue.` )
        }

        // If we have a provider of the correct type, reuse it
        if( state._provider && current_type === target_type ) {
            return state._provider
        }

        // Provider type changed — dispose old one if it exists
        if( state._provider ) {
            log.info( `[use_llm] Switching provider type: ${ current_type } → ${ target_type }` )
            try {
                await state._provider.unload_model()
            } catch { /* best effort */ }
            set( { _provider: null, _provider_promise: null, loaded_model_id: null, is_endpoint_warming: false } )
        }

        // Standard local provider
        if( !state._provider_promise ) {
            const promise = create_provider()
            set( { _provider_promise: promise } )
        }

        const provider = await get()._provider_promise
        set( { _provider: provider, _provider_type: `local` } )
        return provider

    },

    /**
     * Load a model by ID, with deduplication.
     * If a load for the same model is already in-flight, returns
     * the existing promise instead of starting a new one.
     *
     * @param {string} model_id
     * @param {Function} [on_progress]
     * @returns {Promise<void>}
     */
    load_model: async ( model_id, on_progress ) => {

        const state = get()

        // Already loaded — nothing to do
        if( state.loaded_model_id === model_id
            && !state.is_loading
            && state._provider?.is_ready() ) return

        // Already loading this exact model — return existing promise
        if( state._load_promise && state._loading_model_id === model_id ) {
            return state._load_promise
        }

        const promise = ( async () => {

            const provider = await get().ensure_provider( model_id )

            log.info( `[use_llm] Loading model: ${ model_id }` )

            try {
                await provider.load_model( model_id, on_progress )

                // Use provider's canonical ID — reflects a potentially recreated endpoint
                const final_model_id = provider.get_loaded_model() || model_id
                set( { loaded_model_id: final_model_id } )
                log.info( `[use_llm] Model loaded successfully: ${ final_model_id }` )
            } catch ( err ) {
                log.error( `[use_llm] Model load failed:`, err.message )
                set( { error: err.message } )
                throw err
            } finally {
                set( { is_loading: false, _load_promise: null, _loading_model_id: null } )
            }

        } )()

        // Set ALL loading state in one synchronous call — prevents a race
        // where a concurrent caller sees _load_promise but _loading_model_id
        // hasn't been set yet (it was previously inside the async IIFE,
        // after the first `await`, giving a window for the dedup to miss)
        set( { is_loading: true, error: null, _loading_model_id: model_id, _load_promise: promise } )

        return promise

    },

    /**
     * Stream a chat completion.
     * Manages is_generating and prompt_progress, and accumulates stats.
     * A user stop resolves with the partial text and `stats.stopped`.
     *
     * @param {Array} messages
     * @param {Object} [opts]
     * @param {Function} on_token - Called with ( full_text, latest_chunk ), at most once per frame
     * @returns {Promise<{ text: string, stats: Object }>}
     */
    chat_stream: async ( messages, opts, on_token ) => {

        const provider = get()._provider

        if( !provider || !provider.is_ready() ) {
            throw new Error( `No model loaded` )
        }

        // Identifies this run, so a stopped predecessor settling late cannot
        // clear the state of the reply that replaced it
        const run = {}
        set( { is_generating: true, prompt_progress: null, stats: null, error: null, _stop_requested: false, _run: run } )

        let full_text = ``
        let chunk_count = 0
        let timings = null
        const emit = per_frame( ( ...args ) => on_token?.( ...args ) )
        const show_progress = per_frame( prompt_progress => set( { prompt_progress } ) )
        let first_token_time = null
        const start_time = performance.now()

        // Prefer llama.cpp's own counts; chunk counting is the Electron fallback
        const build_stats = extra => {
            const elapsed_ms = performance.now() - start_time
            const ttft_ms = first_token_time ? first_token_time - start_time : 0
            const decode_ms = first_token_time ? elapsed_ms - ttft_ms : 0
            return {
                tokens_generated: timings?.predicted_n ?? chunk_count,
                tokens_per_second: timings?.predicted_per_second
                    ?? ( decode_ms > 0 ? chunk_count / ( decode_ms / 1000 ) : 0 ),
                elapsed_ms,
                ttft_ms,
                decode_ms,
                ... timings?.prompt_n ? { prompt_tokens: timings.prompt_n } : {},
                ...extra,
            }
        }

        try {

            const stream = provider.chat_stream( messages, opts )

            for await ( const chunk of stream ) {

                // Metadata from wllama: prompt reading progress and final timings
                if( typeof chunk !== `string` ) {
                    if( chunk.prompt_progress && get()._run === run ) show_progress( chunk.prompt_progress )
                    if( chunk.timings ) ( { timings } = chunk )
                    continue
                }

                if( !first_token_time ) {
                    first_token_time = performance.now()
                    show_progress.flush()
                    set( { prompt_progress: null } )
                }
                full_text += chunk
                chunk_count++
                emit( full_text, chunk )
            }
            emit.flush()

            const stopped = get()._stop_requested
            const generation_stats = build_stats( stopped ? { stopped } : {} )

            log.info( `[use_llm] Generation ${ stopped ? `stopped` : `complete` }: ${ generation_stats.tokens_generated } tokens in ${ generation_stats.elapsed_ms.toFixed( 0 ) }ms (TTFT ${ generation_stats.ttft_ms.toFixed( 0 ) }ms)` )

            // An empty reply that nobody stopped usually means a template problem
            if( !stopped && !full_text ) {
                full_text = `*The model returned an empty response. This can happen when the chat template is incompatible. Try a different model or check the browser console for details.*`
                if( on_token ) on_token( full_text )
            }

            set( { stats: generation_stats } )
            return { text: full_text, stats: generation_stats }

        } catch ( err ) {

            emit.flush()

            // User-initiated stop — keep the partial text and mark it
            if( err.name === `AbortError` || get()._stop_requested ) {
                const generation_stats = build_stats( { stopped: true } )
                log.info( `[use_llm] Generation stopped after ${ generation_stats.tokens_generated } tokens` )
                set( { stats: generation_stats } )
                return { text: full_text, stats: generation_stats }
            }

            // Real error — log, set state, and re-throw so callers can display it
            log.error( `[use_llm] Generation error:`, err.message )
            set( {
                error: err.message,
                ... provider.is_ready() ? {} : { loaded_model_id: null },
            } )
            throw err

        } finally {
            show_progress.flush()
            if( get()._run === run ) set( { is_generating: false, prompt_progress: null, _stop_requested: false, _run: null } )
        }

    },

    /**
     * Abort current generation. The UI updates at once; the provider
     * finishes its in-flight work in the background.
     */
    abort: () => {
        const { _provider: provider, is_generating } = get()
        if( is_generating ) set( { _stop_requested: true } )
        if( provider ) provider.abort()
    },

    /**
     * Unload the current model.
     * Clears all loading state first — if a load is in-flight, exit()
     * kills the WASM worker and the pending loadModel() promise may
     * never settle, so we can't rely on the finally block to reset state.
     */
    unload_model: async () => {

        const provider = get()._provider

        // Reset state synchronously so the next load_model call starts fresh
        // instead of deduplicating against a zombie promise
        set( {
            is_loading: false,
            loaded_model_id: null,
            error: null,
            _load_promise: null,
            _loading_model_id: null,
        } )

        if( provider ) {
            await provider.unload_model()
        }

    },

    /**
     * Check if the provider is ready for inference
     * @returns {boolean}
     */
    is_ready: () => {
        return get()._provider?.is_ready() || false
    },

} ) )

export default use_llm_store
