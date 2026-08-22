import { create } from 'zustand'
import { log } from 'mentie'
import { create_provider } from '../providers/factory'
import { storage_key } from '../utils/branding'

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

    // ── Internal (not consumed by UI) ────────────────────────────────

    _provider: null,
    _provider_type: null,     // 'local' | 'openrouter' | 'venice'
    _provider_promise: null,
    _load_promise: null,
    _loading_model_id: null,

    // ── Actions ──────────────────────────────────────────────────────

    /**
     * Ensure the provider is initialised (handles async creation).
     * Uses a shared promise so all concurrent callers get the same instance.
     *
     * If the active model starts with 'openrouter:' or 'venice:', creates the
     * corresponding cloud provider. Otherwise, creates the standard local provider.
     */
    ensure_provider: async ( model_id ) => {

        const state = get()
        const target_id = model_id || localStorage.getItem( storage_key( `active_model_id` ) ) || ``

        // Determine the target provider type from the model ID prefix
        const target_type = target_id.startsWith( `openrouter:` ) ? `openrouter`
            : target_id.startsWith( `venice:` ) ? `venice`
                : `local`

        const current_type = state._provider_type

        // Gracefully handle stale `runpod:` prefix from previous versions
        if( target_id.startsWith( `runpod:` ) ) {
            log.warn( `[use_llm] Stale runpod: prefix — clearing active model` )
            localStorage.removeItem( storage_key( `active_model_id` ) )
            return null
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

        if( target_type === `openrouter` ) {

            // Lazy import to keep the OpenRouter provider out of the main bundle
            const { default: OpenRouterProvider } = await import( `../providers/openrouter_provider.js` )

            const openrouter_model_id = target_id.replace( `openrouter:`, `` )

            // Read config from the OpenRouter store
            const config_raw = localStorage.getItem( storage_key( `openrouter_config` ) )
            const config = config_raw ? JSON.parse( config_raw ) : {}

            const provider = new OpenRouterProvider( {
                api_key: config.api_key || ``,
                model_id: openrouter_model_id,
            } )

            set( { _provider: provider, _provider_type: `openrouter` } )
            return provider

        }

        if( target_type === `venice` ) {

            // Lazy import to keep the Venice provider out of the main bundle
            const { default: VeniceProvider } = await import( `../providers/venice_provider.js` )

            const venice_model_id = target_id.replace( `venice:`, `` )

            // Read config from the Venice store
            const config_raw = localStorage.getItem( storage_key( `venice_config` ) )
            const config = config_raw ? JSON.parse( config_raw ) : {}

            const provider = new VeniceProvider( {
                api_key: config.api_key || ``,
                model_id: venice_model_id,
            } )

            set( { _provider: provider, _provider_type: `venice` } )
            return provider

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
     * Manages is_generating flag and accumulates stats.
     *
     * @param {Array} messages
     * @param {Object} [opts]
     * @param {Function} on_token - Called with ( full_text, chunk )
     * @returns {Promise<{ text: string, stats: Object }>}
     */
    chat_stream: async ( messages, opts, on_token ) => {

        const provider = get()._provider

        if( !provider || !provider.is_ready() ) {
            throw new Error( `No model loaded` )
        }

        set( { is_generating: true, stats: null, error: null } )

        let full_text = ``
        let token_count = 0
        let first_token_time = null
        const start_time = performance.now()

        try {

            const stream = provider.chat_stream( messages, opts )

            for await ( const chunk of stream ) {
                if( !first_token_time ) first_token_time = performance.now()
                full_text += chunk
                token_count++
                if( on_token ) on_token( full_text, chunk )
            }

            const elapsed_ms = performance.now() - start_time
            const ttft_ms = first_token_time ? first_token_time - start_time : 0
            const decode_ms = elapsed_ms - ttft_ms

            log.info( `[use_llm] Generation complete: ${ token_count } tokens in ${ elapsed_ms.toFixed( 0 ) }ms (TTFT ${ ttft_ms.toFixed( 0 ) }ms)` )

            // When the model produces nothing, show a helpful message
            if( token_count === 0 && !full_text ) {
                full_text = `*The model returned an empty response. This can happen when the chat template is incompatible. Try a different model or check the browser console for details.*`
                if( on_token ) on_token( full_text )
            }

            const generation_stats = {
                tokens_generated: token_count,
                tokens_per_second: decode_ms > 0 ? token_count / ( decode_ms / 1000 ) : 0,
                elapsed_ms,
                ttft_ms,
                decode_ms,
            }

            set( { stats: generation_stats } )
            return { text: full_text, stats: generation_stats }

        } catch ( err ) {

            if( err.name === `AbortError` || err.message?.includes( `abort` ) ) {

                // User-initiated abort — return partial result silently
                const elapsed_ms = performance.now() - start_time
                const ttft_ms = first_token_time ? first_token_time - start_time : 0
                const decode_ms = elapsed_ms - ttft_ms

                return {
                    text: full_text,
                    stats: {
                        tokens_generated: token_count,
                        tokens_per_second: decode_ms > 0 ? token_count / ( decode_ms / 1000 ) : 0,
                        elapsed_ms,
                        ttft_ms,
                        decode_ms,
                    },
                }

            }

            // Real error — log, set state, and re-throw so callers can display it
            log.error( `[use_llm] Generation error:`, err.message )
            set( {
                error: err.message,
                ... provider.is_ready() ? {} : { loaded_model_id: null },
            } )
            throw err

        } finally {
            set( { is_generating: false } )
        }

    },

    /**
     * Abort current generation
     */
    abort: () => {
        const provider = get()._provider
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
