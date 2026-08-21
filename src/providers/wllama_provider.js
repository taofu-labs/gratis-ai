import { Wllama, WllamaError } from 'wllama64'
import { log } from 'mentie'
import { get_db } from '../stores/db'
import { DEFAULT_RUNTIME_CONTEXT, get_model_by_id } from '../utils/model_catalog'
import { get_browser_cached_model } from '../utils/model_download'

// Memory64 is the primary runtime. The matching wasm32 build remains local so
// Safari and older browsers never need to fetch executable code from a CDN.
const CONFIG_PATHS = { default: `/wasm/wllama.wasm` }
const COMPAT_PATHS = {
    worker: `/wasm/compat/wllama.js`,
    wasm: `/wasm/compat/wllama.wasm`,
}

const WLLAMA_LOGGER = {
    debug: ( ...args ) => log.debug( `[wllama64]`, ...args ),
    log: ( ...args ) => log.info( `[wllama64]`, ...args ),
    warn: ( ...args ) => log.warn( `[wllama64]`, ...args ),
    error: ( ...args ) => log.error( `[wllama64]`, ...args ),
}

/**
 * Browser-based LLM provider using wllama64 (Memory64 llama.cpp).
 * Implements the LLMProvider interface from types.js.
 */
export default class WllamaProvider {

    constructor() {
        this._wllama = null
        this._loaded_model_id = null
        this._abort_controller = null
    }

    /**
     * Load a GGUF model from the browser cache.
     * New downloads live in Wllama's streaming OPFS cache; legacy IndexedDB
     * blobs remain supported so upgrades do not force a multi-GB re-download.
     * @param {string} model_id - The model ID in IndexedDB
     * @param {Function} [on_progress] - Progress callback
     * @returns {Promise<void>}
     */
    async load_model( model_id, on_progress ) {

        if( this._loaded_model_id === model_id && this._wllama?.isModelLoaded() ) {
            log.info( `[wllama] Model ${ model_id } already loaded, skipping reload` )
            if( on_progress ) on_progress( { progress: 1, status: `Model ready` } )
            return
        }

        if( this._wllama ) await this.unload_model()

        const db = await get_db()
        const cached = await db.get( `models`, model_id )

        if( !cached?.blob && !cached?.download_url ) {
            throw new Error( `Model ${ model_id } not found in cache` )
        }

        const model = get_model_by_id( model_id )
        let stored_model = null

        try {
            if( cached.download_url ) {
                const expected_size = cached.file_size_bytes || model?.file_size_bytes
                stored_model = await get_browser_cached_model( cached.download_url, expected_size )
            }
        } catch ( error ) {
            log.warn( `[wllama] Could not access browser model storage:`, error )
        }

        if( cached.download_url && !stored_model ) {
            throw new Error( `Model files are missing from browser storage. Download the model again.` )
        }

        if( on_progress ) on_progress( { progress: 0, status: `Loading model into memory...` } )

        this._wllama = new Wllama( CONFIG_PATHS, {
            allowOffline: true,
            logger: WLLAMA_LOGGER,
            suppressNativeLog: true,
        } )
        // The second argument permits Firefox to use the local wasm32 fallback
        // when its Memory64/JSPI path is unavailable.
        this._wllama.setCompat( COMPAT_PATHS, `firefox_safari` )

        const { compat } = this._wllama.getWorkerResources()
        const runtime_name = compat ? `wasm32 compatibility` : `Memory64`

        // Keep enough CPU for the browser compositor. Large reported core counts
        // otherwise create a wasteful pthread pool in desktop-class browsers.
        const hardware_threads = navigator.hardwareConcurrency || 1
        const n_threads = Math.min( 8, Math.max( 1, Math.floor( hardware_threads / 2 ) ) )
        const n_batch = n_threads > 1 ? 512 : 256
        const n_ctx = Math.min( cached.context_length || DEFAULT_RUNTIME_CONTEXT, DEFAULT_RUNTIME_CONTEXT )
        const reasoning_enabled = cached.reasoning_enabled ?? model?.reasoning_enabled
        const file_size_mb = ( cached.file_size_bytes / 1_000_000 ).toFixed( 0 )

        log.info( `[wllama] Loading ${ model_id } (${ file_size_mb } MB, ${ runtime_name }, ${ n_threads } threads, ${ n_ctx } ctx)` )

        const load_options = {
            n_ctx,
            n_batch,
            n_threads,
            n_parallel: 1,

            // Wllama v3 enables WebGPU by default. Keep the migration CPU-stable:
            // GPU offload and quantized KV cache have different memory behavior
            // and need their own measured rollout.
            n_gpu_layers: 0,
            cache_type_k: `f16`,
            cache_type_v: `f16`,

            // Let llama.cpp render the GGUF's embedded Jinja template. Manual
            // family guessing breaks Qwen 3.5, Ministral 3, Gemma, and Harmony.
            jinja: true,

            // Keep reasoning markup in the normal content stream: the existing
            // UI parses <think> blocks itself and has no separate V3 reasoning
            // channel. Only override template generation when a model declares
            // a deliberate default (Qwen 3.5 2B defaults to non-thinking).
            reasoning: false,
            ... reasoning_enabled !== undefined ? {
                default_template_kwargs: { enable_thinking: reasoning_enabled },
            } : {},
        }

        try {

            if( cached.blob ) {
                await this._wllama.loadModel( [ cached.blob ], load_options )
            } else {
                await this._wllama.loadModel( stored_model, load_options )
            }

        } catch ( load_error ) {

            await this._dispose_runtime()

            const message = load_error?.message || ``
            const is_memory_error = load_error instanceof RangeError
                || /memory|out of bounds|allocation failed|cannot allocate/i.test( message )

            if( is_memory_error ) {
                log.error( `[wllama] Out of memory loading ${ model_id } (${ file_size_mb } MB)` )
                throw new Error( `This model is too large for your browser's available memory. Try a smaller model or close other tabs.` )
            }

            if( load_error instanceof WllamaError && load_error.type === `load_error` ) {
                log.error( `[wllama] Runtime rejected ${ model_id }:`, load_error )
                throw new Error( `This model could not be loaded by the browser runtime. Delete it, re-download it, or try a smaller model.` )
            }

            log.error( `[wllama] Failed to load model:`, load_error )
            throw load_error

        }

        if( !this._wllama.getChatTemplate() ) {
            await this.unload_model()
            throw new Error( `This GGUF has no embedded chat template. Choose an instruct/chat model instead of a base model.` )
        }

        this._loaded_model_id = model_id

        const [ model_name, model_arch ] = this._model_identity()
        log.info( `[wllama] Ready: ${ model_name } (${ model_arch }, ${ runtime_name })` )

        // Timestamp writes are non-critical; a full storage quota must not make
        // an otherwise healthy model fail after loading.
        try {
            await db.put( `models`, { ...cached, last_used_at: Date.now() } )
        } catch {
            log.warn( `[wllama] Could not update last_used_at (storage quota may be full)` )
        }

        if( on_progress ) on_progress( { progress: 1, status: `Model ready` } )

    }

    /**
     * Single-shot chat completion.
     * @param {import('./types').ChatMessage[]} messages
     * @param {import('./types').GenerateOptions} [opts]
     * @returns {Promise<string>}
     */
    async chat( messages, opts = {} ) {

        this._assert_ready()

        const started_at = performance.now()
        const response = await this._wllama.createChatCompletion( {
            messages,
            ...this._build_completion_options( opts ),
        } )

        const content = response.choices?.[ 0 ]?.message?.content || ``
        const token_count = response.usage?.completion_tokens || 0
        const elapsed_s = ( performance.now() - started_at ) / 1000
        const [ model_name, model_arch ] = this._model_identity()

        log.info( `[wllama] [${ model_name } (${ model_arch })] Chat complete — ${ token_count } tokens in ${ elapsed_s.toFixed( 1 ) }s` )

        return content

    }

    /**
     * Streaming chat completion — yields text deltas as they arrive.
     * @param {import('./types').ChatMessage[]} messages
     * @param {import('./types').GenerateOptions} [opts]
     * @returns {AsyncGenerator<string>}
     */
    async *chat_stream( messages, opts = {} ) {

        this._assert_ready()
        this._abort_controller = new AbortController()

        const started_at = performance.now()
        let first_token_at = null
        let token_count = 0

        try {

            const stream = await this._wllama.createChatCompletion( {
                messages,
                ...this._build_completion_options( opts ),
                stream: true,
                abortSignal: this._abort_controller.signal,
            } )

            for await ( const chunk of stream ) {

                const text = chunk.choices?.[ 0 ]?.delta?.content || ``
                const reported_tokens = chunk.usage?.completion_tokens || chunk.timings?.predicted_n
                if( reported_tokens ) token_count = reported_tokens

                if( text ) {
                    if( first_token_at === null ) first_token_at = performance.now()
                    yield text
                }

            }

            const elapsed_ms = performance.now() - started_at
            const ttft_ms = first_token_at === null ? elapsed_ms : first_token_at - started_at
            const decode_ms = Math.max( elapsed_ms - ttft_ms, 0 )
            const tokens_per_second = decode_ms > 0 ? token_count / ( decode_ms / 1000 ) : 0
            const [ model_name, model_arch ] = this._model_identity()

            log.info( `[wllama] [${ model_name } (${ model_arch })] ${ token_count } tokens — ttft ${ ttft_ms.toFixed( 0 ) }ms, ${ tokens_per_second.toFixed( 1 ) } tk/s` )

        } catch ( error ) {
            if( error.name === `AbortError` || error.message?.includes( `abort` ) ) return
            throw error
        } finally {
            this._abort_controller = null
        }

    }

    /** Abort any in-progress generation. */
    abort() {
        if( !this._abort_controller ) return
        this._abort_controller.abort()
        this._abort_controller = null
    }

    /**
     * Unload the current model from memory.
     * @returns {Promise<void>}
     */
    async unload_model() {
        if( this._wllama ) log.info( `[wllama] Unloading model ${ this._loaded_model_id }` )
        await this._dispose_runtime()
        this._loaded_model_id = null
    }

    /**
     * Get the currently loaded model ID.
     * @returns {string|null}
     */
    get_loaded_model() {
        return this._loaded_model_id
    }

    /**
     * Check if a model is loaded and ready.
     * @returns {boolean}
     */
    is_ready() {
        return !!this._wllama?.isModelLoaded()
    }

    /** Assert that inference can start. */
    _assert_ready() {
        if( !this.is_ready() ) throw new Error( `No model loaded` )
    }

    /** Release the current WASM worker even after a partial load failure. */
    async _dispose_runtime() {
        if( !this._wllama ) return
        try {
            await this._wllama.exit()
        } catch {
            // A crashed worker has already released its resources.
        }
        this._wllama = null
    }

    /**
     * Read the actual model identity from GGUF metadata.
     * @returns {[string, string]}
     */
    _model_identity() {
        const meta = this._wllama?.getModelMetadata()?.meta || {}
        return [
            meta[`general.name`] || this._loaded_model_id || `unknown`,
            meta[`general.architecture`] || `?`,
        ]
    }

    /**
     * Build Wllama's OpenAI-compatible completion options.
     * @param {import('./types').GenerateOptions} opts
     * @returns {Object}
     */
    _build_completion_options( opts ) {

        return {
            max_tokens: opts.max_tokens ?? 2048,
            temperature: opts.temperature ?? 0.7,
            top_p: opts.top_p ?? 0.95,
            top_k: opts.top_k ?? 40,
            min_p: opts.min_p ?? 0.05,
            penalty_repeat: opts.repeat_penalty ?? 1.1,
            penalty_last_n: opts.repeat_last_n ?? 64,
            penalty_freq: opts.frequency_penalty ?? 0,
            penalty_present: opts.presence_penalty ?? 0,
            cache_prompt: true,
            ... opts.seed !== undefined && opts.seed !== -1 ? { seed: opts.seed } : {} ,
            ... opts.stop_sequences?.length ? { stop: opts.stop_sequences } : {} ,
        }

    }

}
