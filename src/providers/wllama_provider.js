import { Wllama, WllamaError, WllamaRuntimeError } from 'wllama64'
import { log } from 'mentie'
import { get_db } from '../stores/db'
import {
    detect_capabilities,
    estimate_max_model_bytes,
    probe_capabilities_gpu_memory,
} from '../utils/device_detection'
import { select_gpu_offload_layers } from '../utils/gpu_offload'
import { ModelFitError } from '../utils/model_fit_error'
import { wait_for_existing_webgpu_memory_probe } from '../utils/webgpu_memory'
import {
    DEFAULT_RUNTIME_CONTEXT,
    estimate_model_memory,
    get_model_by_id,
    select_browser_batch,
    select_browser_context,
} from '../utils/model_catalog'
import { get_browser_cached_model } from '../utils/model_download'

// Memory64 is the primary runtime. The matching wasm32 build remains local so
// Safari and older browsers never need to fetch executable code from a CDN.
const CONFIG_PATHS = { default: `/wasm/wllama.wasm` }
const COMPAT_PATHS = {
    worker: `/wasm/compat/wllama.js`,
    wasm: `/wasm/compat/wllama.wasm`,
}
const INFERENCE_DIAGNOSTICS = import.meta.env.VITE_INFERENCE_DIAGNOSTICS === `1`
const GPU_LOAD_MIN_TIMEOUT_MS = 120_000
const GPU_LOAD_BYTES_PER_SECOND = 8 * 1024 ** 2
const GPU_TOKEN_TIMEOUT_MS = 300_000
const RUNTIME_EXIT_TIMEOUT_MS = 5_000

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
        this._gpu_disabled = false
        this._gpu_layers = 0
        this._reload_context = null
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
                // Catalog size wins over cached metadata so an interrupted
                // download cannot validate itself using its truncated length.
                const expected_size = model?.file_size_bytes || cached.file_size_bytes
                stored_model = await get_browser_cached_model( cached.download_url, expected_size )
            }
        } catch ( error ) {
            log.warn( `[wllama] Could not access browser model storage:`, error )
        }

        if( cached.download_url && !stored_model ) {
            throw new Error( `Model files are missing from browser storage. Download the model again.` )
        }

        if( on_progress ) on_progress( { progress: 0, status: `Checking available memory...` } )

        const capabilities = await detect_capabilities()
        const memory_budget = estimate_max_model_bytes( capabilities )
        const fit_model = model || {
            ...cached,
            file_size_bytes: cached.file_size_bytes || cached.blob?.size || 0,
        }
        const required_memory = estimate_model_memory( fit_model )

        if( required_memory > memory_budget ) {
            throw new ModelFitError(
                `This model needs about ${ Math.ceil( required_memory / 1_000_000_000 * 10 ) / 10 } GB, more than this browser can safely use. Choose a smaller model or delete this cached copy from model settings.`,
                { required_memory, memory_budget, model_id },
            )
        }

        // Keep enough CPU for the browser compositor. Large reported core counts
        // otherwise create a wasteful pthread pool in desktop-class browsers.
        const hardware_threads = navigator.hardwareConcurrency || 1
        const n_threads = Math.min( 8, Math.max( 1, Math.floor( hardware_threads / 2 ) ) )
        const model_size = cached.file_size_bytes || model?.file_size_bytes || 0

        // Near-ceiling models need compute-graph headroom more than prompt
        // throughput. A 512-token batch can add a large transient allocation
        // on top of 8–12 GB of weights.
        const n_batch = select_browser_batch( model_size, n_threads )
        const n_ctx = model
            ? select_browser_context( model, memory_budget )
            : DEFAULT_RUNTIME_CONTEXT
        const reasoning_enabled = cached.reasoning_enabled ?? model?.reasoning_enabled
        const file_size_mb = ( model_size / 1_000_000 ).toFixed( 0 )

        const load_options = {
            n_ctx,
            n_batch,
            n_threads,
            n_parallel: 1,

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

        const source = cached.blob ? [ cached.blob ] : stored_model
        let probed_capabilities = capabilities

        if( !this._gpu_disabled && capabilities.gpu?.webgpu ) {
            if( model?.block_count ) {
                if( on_progress ) on_progress( { progress: 0, status: `Measuring GPU memory...` } )
                probed_capabilities = await probe_capabilities_gpu_memory( capabilities )
            } else {
                // A capability hook may already hold large buffers on UMA.
                // Join it before loading a custom/legacy GGUF, but never start
                // a probe that cannot produce an offload layer count.
                await wait_for_existing_webgpu_memory_probe()
            }
        }

        let gpu_layers = this._gpu_disabled ? 0 : select_gpu_offload_layers( {
            model,
            gpu_probe: probed_capabilities.gpu?.memory_source === `measured` ? {
                status: `measured`,
                measured_bytes: probed_capabilities.gpu.allocatable_bytes,
            } : null,
            ram_budget_bytes: memory_budget,
            context_length: n_ctx,
        } )

        let runtime_name = `Memory64`

        if( gpu_layers > 0 ) {

            if( on_progress ) on_progress( { progress: 0, status: `Loading model with GPU acceleration...` } )

            try {
                const loaded = await this._load_runtime_attempt( source, {
                    ...load_options,
                    n_gpu_layers: gpu_layers,
                }, model_size )
                runtime_name = loaded.compat ? `wasm32 compatibility` : `Memory64`
                this._gpu_layers = gpu_layers
            } catch ( gpu_error ) {
                this._gpu_disabled = true
                gpu_layers = 0
                log.warn( `[wllama] GPU load failed; retrying ${ model_id } on CPU:`, gpu_error )
                if( on_progress ) on_progress( { progress: 0, status: `GPU unavailable — retrying safely on CPU...` } )
                await new Promise( resolve => setTimeout( resolve, 50 ) )

            }

        }

        if( !this._wllama?.isModelLoaded() ) {

            if( on_progress ) on_progress( { progress: 0, status: gpu_layers === 0 && this._gpu_disabled
                ? `Loading model with CPU fallback...`
                : `Loading model into memory...` } )

            try {
                const loaded = await this._load_runtime_attempt( source, {
                    ...load_options,
                    n_gpu_layers: 0,
                }, model_size )
                runtime_name = loaded.compat ? `wasm32 compatibility` : `Memory64`
                this._gpu_layers = 0
            } catch ( load_error ) {
                throw this._friendly_load_error( load_error, model_id, file_size_mb )
            }

        }

        const backend_name = this._gpu_layers > 0
            ? `${ this._gpu_layers === 99_999 ? `all` : this._gpu_layers } GPU layers requested`
            : `CPU`

        log.info( `[wllama] Loaded ${ model_id } (${ file_size_mb } MB, ${ runtime_name }, ${ backend_name }, ${ n_threads } threads, ${ n_ctx } ctx)` )

        if( !this._wllama.getChatTemplate() ) {
            await this.unload_model()
            throw new Error( `This GGUF has no embedded chat template. Choose an instruct/chat model instead of a base model.` )
        }

        this._loaded_model_id = model_id
        this._reload_context = {
            model_id,
            source,
            load_options,
            model_size,
        }

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
        let response

        try {
            response = await this._create_chat_completion( {
                messages,
                ...this._build_completion_options( opts ),
            } )
        } catch ( error ) {
            if( this._gpu_layers <= 0 || !this._should_reload_on_cpu( error ) ) throw error
            await this._reload_on_cpu( error )
            response = await this._create_chat_completion( {
                messages,
                ...this._build_completion_options( opts ),
            } )
        }

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
        const abort_controller = new AbortController()
        this._abort_controller = abort_controller

        const started_at = performance.now()
        let first_token_at = null
        let token_count = 0
        let emitted_text = false

        try {

            const stream = await this._create_chat_completion( {
                messages,
                ...this._build_completion_options( opts ),
                stream: true,
                abortSignal: abort_controller.signal,
            } )

            const iterator = stream[ Symbol.asyncIterator ]()

            while( true ) {

                const { value: chunk, done } = await this._next_stream_chunk( iterator )
                if( done ) break

                const text = chunk.choices?.[ 0 ]?.delta?.content || ``
                const reported_tokens = chunk.usage?.completion_tokens || chunk.timings?.predicted_n
                if( reported_tokens ) token_count = reported_tokens

                if( text ) {
                    if( first_token_at === null ) first_token_at = performance.now()
                    emitted_text = true
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

            if( this._gpu_layers > 0 && this._should_reload_on_cpu( error ) ) {
                await this._reload_on_cpu( error )
                if( abort_controller.signal.aborted ) return

                // Restart only before output becomes visible. Replaying after a
                // partial stream could duplicate or diverge from existing text.
                if( !emitted_text ) {
                    yield* this.chat_stream( messages, opts )
                    return
                }
            }

            throw error
        } finally {
            if( this._abort_controller === abort_controller ) this._abort_controller = null
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
        this._gpu_layers = 0
        this._reload_context = null
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

    /**
     * Load one fresh Wllama runtime and reject if its worker dies or stalls.
     * wllama64 is exact-pinned; guarded access to proxy.worker closes a gap in
     * its public API where Worker.onerror otherwise only logs.
     *
     * @param {Blob[]|import('wllama64').Model} source
     * @param {Object} load_options
     * @param {number} model_size
     * @returns {Promise<{compat: boolean}>}
     */
    async _load_runtime_attempt( source, load_options, model_size ) {

        let reject_worker
        const worker_failure = new Promise( ( _, reject ) => {
            reject_worker = reject
        } )

        const logger = {
            ...WLLAMA_LOGGER,
            error: ( ...args ) => {
                WLLAMA_LOGGER.error( ...args )
                const worker_error = args.find( arg => arg instanceof Error
                    || typeof ErrorEvent !== `undefined` && arg instanceof ErrorEvent )
                if( worker_error ) reject_worker( worker_error.error || worker_error )
            },
        }

        const runtime = new Wllama( CONFIG_PATHS, {
            allowOffline: true,
            logger,
            suppressNativeLog: !INFERENCE_DIAGNOSTICS,
        } )

        runtime.setCompat( COMPAT_PATHS, `firefox_safari` )
        const { compat } = runtime.getWorkerResources()
        this._wllama = runtime

        const timeout_ms = Math.max(
            GPU_LOAD_MIN_TIMEOUT_MS,
            model_size / GPU_LOAD_BYTES_PER_SECOND * 1000 + 60_000,
        )

        let timeout_id
        const timeout = new Promise( ( _, reject ) => {
            timeout_id = setTimeout( () => reject( new Error( `Model worker stopped responding` ) ), timeout_ms )
        } )

        let observed_worker = null
        const worker_poll = setInterval( () => {

            const worker = runtime.proxy?.worker
            if( !worker || worker === observed_worker ) return

            observed_worker = worker
            const previous_handler = worker.onerror
            worker.onerror = event => {
                previous_handler?.( event )
                reject_worker( event?.error || new Error( event?.message || `Model worker crashed` ) )
            }

        }, 10 )

        try {
            await Promise.race( [
                runtime.loadModel( source, load_options ),
                worker_failure,
                timeout,
            ] )
        } catch ( error ) {
            this._force_dispose_runtime( runtime, error )
            throw error
        } finally {
            clearInterval( worker_poll )
            clearTimeout( timeout_id )
        }

        return { compat }

    }

    /** Reject pinned runtime tasks and terminate a worker that stopped replying. */
    _force_dispose_runtime( runtime, error ) {

        try {
            runtime?.proxy?.abort?.( error?.message || `Model runtime failed`, error?.stack || `` )
            runtime?.proxy?.worker?.terminate?.()
            if( runtime?.proxy ) runtime.proxy = null
        } catch {
            // The worker is already dead.
        }

        if( this._wllama === runtime ) this._wllama = null

    }

    /** Convert the final CPU load failure into an actionable user error. */
    _friendly_load_error( load_error, model_id, file_size_mb ) {

        const message = load_error?.message || ``
        const is_memory_error = load_error instanceof RangeError
            || /memory|out of bounds|allocation failed|cannot allocate/i.test( message )

        if( is_memory_error ) {
            log.error( `[wllama] Out of memory loading ${ model_id } (${ file_size_mb } MB)` )
            return new Error( `This model is too large for your browser's available memory. Try a smaller model or close other tabs.` )
        }

        if( load_error instanceof WllamaError && load_error.type === `load_error` ) {
            log.error( `[wllama] Runtime rejected ${ model_id }:`, load_error )
            return new Error( `This model could not be loaded by the browser runtime. Delete it, re-download it, or try a smaller model.` )
        }

        log.error( `[wllama] Failed to load model:`, load_error )
        return load_error

    }

    /**
     * Bound a GPU stream wait so a dead worker cannot leave generation stuck.
     * CPU streams keep their existing unbounded behavior.
     */
    async _next_stream_chunk( iterator ) {

        if( this._gpu_layers <= 0 ) return iterator.next()

        let timeout_id
        const timeout = new Promise( ( _, reject ) => {
            timeout_id = setTimeout( () => reject( new Error( `GPU inference stopped responding` ) ), GPU_TOKEN_TIMEOUT_MS )
        } )

        try {
            return await Promise.race( [ iterator.next(), timeout ] )
        } finally {
            clearTimeout( timeout_id )
        }

    }

    /** Bound creation of a GPU completion so a dead worker reaches CPU fallback. */
    async _create_chat_completion( options ) {

        if( this._gpu_layers <= 0 ) return this._wllama.createChatCompletion( options )

        let timeout_id
        const timeout = new Promise( ( _, reject ) => {
            timeout_id = setTimeout( () => reject( new Error( `GPU inference stopped responding` ) ), GPU_TOKEN_TIMEOUT_MS )
        } )

        try {
            return await Promise.race( [ this._wllama.createChatCompletion( options ), timeout ] )
        } finally {
            clearTimeout( timeout_id )
        }

    }

    /** Distinguish backend/worker failure from normal inference validation. */
    _should_reload_on_cpu( error ) {

        if( error instanceof WllamaRuntimeError ) return true

        return /gpu inference stopped responding|webgpu|wgpu|gpu device|device lost|worker (?:crashed|stopped responding)/i
            .test( error?.message || `` )

    }

    /** Reload the same cached GGUF with WebGPU explicitly disabled. */
    async _reload_on_cpu( gpu_error ) {

        const context = this._reload_context
        if( !context ) throw gpu_error

        log.warn( `[wllama] GPU inference failed; reloading ${ context.model_id } on CPU:`, gpu_error )
        this._gpu_disabled = true
        await this._dispose_runtime()
        await new Promise( resolve => setTimeout( resolve, 50 ) )

        try {
            await this._load_runtime_attempt( context.source, {
                ...context.load_options,
                n_gpu_layers: 0,
            }, context.model_size )
            this._gpu_layers = 0
        } catch ( cpu_error ) {
            this._loaded_model_id = null
            this._reload_context = null
            throw this._friendly_load_error(
                cpu_error,
                context.model_id,
                ( context.model_size / 1_000_000 ).toFixed( 0 ),
            )
        }

    }

    /** Release the current WASM worker even after a partial load failure. */
    async _dispose_runtime() {

        const runtime = this._wllama
        if( !runtime ) return

        this._wllama = null
        let timeout_id
        const timeout = new Promise( ( _, reject ) => {
            timeout_id = setTimeout( () => reject( new Error( `Model worker did not exit` ) ), RUNTIME_EXIT_TIMEOUT_MS )
        } )

        try {
            await Promise.race( [ runtime.exit(), timeout ] )
        } catch ( error ) {
            // A crashed or wedged worker may never answer exit(). Terminate it
            // before constructing the CPU replacement.
            this._force_dispose_runtime( runtime, error )
        } finally {
            clearTimeout( timeout_id )
        }

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
