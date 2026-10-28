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
import { classify_webgpu_adapter, wait_for_existing_webgpu_memory_probe, webgpu_offload_trusted } from '../utils/webgpu_memory'
import {
    estimate_model_memory,
    projector_memory,
    get_model_by_id,
    select_browser_batch,
    select_browser_context,
} from '../utils/model_catalog'
import { get_external_model_file } from '../utils/external_model_files'
import { resolve_hf_model } from '../utils/hf_url_parser'
import { get_browser_cached_model, get_browser_cached_projector, projector_source, verify_installed_model } from '../utils/model_download'
import { COMPAT_PATHS, CONFIG_PATHS } from '../utils/wllama_paths'
import { IMAGE_MAX_TOKENS, IMAGE_MIN_TOKENS, MAX_HISTORY_IMAGES, to_wllama_messages } from '../utils/attachments'

const INFERENCE_DIAGNOSTICS = import.meta.env.VITE_INFERENCE_DIAGNOSTICS === `1`
const GPU_LOAD_MIN_TIMEOUT_MS = 120_000
const GPU_LOAD_BYTES_PER_SECOND = 8 * 1024 ** 2
const GPU_TOKEN_TIMEOUT_MS = 300_000
const RUNTIME_EXIT_TIMEOUT_MS = 5_000

// llama.cpp decodes one prompt batch per worker call and only then sees a
// cancel. On CPU, throughput barely changes above ~128 tokens per batch, so
// smaller batches buy finer prefill progress and a quicker stop for free.
const CPU_PROMPT_BATCH = 128

// Measured in headful Chromium on a clean 4 vCPU runner (scripts/bench):
// flash attention plus a q8_0 KV cache decodes 23–65% faster than f16 on CPU
// because WASM decode is memory-bandwidth bound. GPU loads keep f16 until
// WebGPU FA/quantized-KV support is verified on real hardware.
const CPU_FAST_OPTIONS = {
    flash_attn: true,
    cache_type_k: `q8_0`,
    cache_type_v: `q8_0`,
}

// Vision: an image becomes IMAGE_MIN_TOKENS–IMAGE_MAX_TOKENS tokens. Models with
// non-causal image attention (Gemma 3) need the whole image in one
// micro-batch, so vision loads raise n_batch/n_ubatch to match.
const VISION_MIN_CONTEXT = 4096

/** CPU-only runtime options; GPU offload keeps its larger batch and f16 KV. */
const cpu_load_options = load_options => {
    const prompt_batch = Math.max( Math.min( load_options.n_batch, CPU_PROMPT_BATCH ), load_options.image_max_tokens || 0 )
    return {
        ...load_options,
        ...CPU_FAST_OPTIONS,
        n_gpu_layers: 0,
        n_batch: prompt_batch,
        n_ubatch: prompt_batch,
    }
}

/** Promise with external resolve. */
const deferred = () => {
    let resolve
    const promise = new Promise( done => {
        resolve = done
    } )
    return { promise, resolve }
}

/** A load superseded by an unload or a newer load; not a failure to report. */
const load_interrupted = () => Object.assign( new Error( `Model load was interrupted. Try again.` ), { name: `LoadInterruptedError` } )

/** Allocation failures; a retry with larger buffers cannot succeed. */
const is_memory_error = error => error instanceof RangeError
    || /memory|out of bounds|allocation failed|cannot allocate/i.test( error?.message || `` )

/** Build the error a stopped generation rejects with. */
const abort_error = () => Object.assign( new Error( `Generation stopped` ), { name: `AbortError` } )

// Name-based on purpose: an Emscripten crash also says "Aborted()"
const is_abort = error => error?.name === `AbortError`

/**
 * Settle with the user's stop instead of the worker. Wllama only notices an
 * abort after its current batch returns, which can take seconds on slow CPUs.
 * @param {Promise} promise - Pending worker call
 * @param {AbortSignal} signal
 * @returns {Promise}
 */
const until_aborted = ( promise, signal ) => {

    if( signal.aborted ) return Promise.reject( abort_error() )

    let on_abort
    const aborted = new Promise( ( _, reject ) => {
        on_abort = () => reject( abort_error() )
        signal.addEventListener( `abort`, on_abort, { once: true } )
    } )

    return Promise.race( [ promise, aborted ] ).finally( () => signal.removeEventListener( `abort`, on_abort ) )

}

const WLLAMA_LOGGER = {
    debug: ( ...args ) => log.debug( `[wllama64]`, ...args ),
    log: ( ...args ) => log.info( `[wllama64]`, ...args ),
    warn: ( ...args ) => log.warn( `[wllama64]`, ...args ),
    error: ( ...args ) => log.error( `[wllama64]`, ...args ),
}

const has_architecture_metadata = model =>
    !!( model?.layers && model?.kv_heads && model?.head_dim )

const hydrate_cached_model = async ( model_id, cached, db ) => {
    const catalog_model = get_model_by_id( model_id )
    if( catalog_model ) return catalog_model
    if( has_architecture_metadata( cached ) ) return cached
    if( !cached.hugging_face_repo || !cached.file_name ) return cached

    try {
        const hydrated = await resolve_hf_model( {
            repo: cached.hugging_face_repo,
            file_name: cached.file_name,
            quantization: null,
        } )
        const merged = {
            ...cached,
            ...hydrated,
            id: cached.id || model_id,
            storage: cached.storage,
            blob: cached.blob,
            file_handle: cached.file_handle,
            download_url: cached.download_url,
            cached_at: cached.cached_at,
            last_used_at: cached.last_used_at,
            file_size_bytes: cached.file_size_bytes || hydrated.file_size_bytes,
        }

        await Promise.resolve( db.put( `models`, merged ) ).catch( () => {
            log.warn( `[wllama] Could not persist hydrated custom model metadata` )
        } )
        return merged
    } catch ( error ) {
        log.warn( `[wllama] Could not hydrate custom model metadata:`, error )
        return cached
    }
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
        this._prefill_controller = null
        this._gpu_disabled = false
        this._gpu_layers = 0
        this._reload_context = null

        // What the loaded model can read beyond text; see get_capabilities()
        this._capabilities = { image_input: false, image_blocked: null, context_size: 0 }

        // Resolves once a stopped request has really left the worker
        this._settling = Promise.resolve()

        // Each runtime is one epoch. Disposal ends it, releasing everything
        // that waited on a worker that will never answer again.
        this._runtime_epoch = 0
        this._epoch_ended = deferred()
        this._load_chain = Promise.resolve()

        // Bumped by unload_model(); a load from an older generation must stop
        this._load_generation = 0
    }

    /** Throw if an unload happened since `generation` started loading. */
    _assert_load_current( generation ) {
        if( this._load_generation !== generation ) throw load_interrupted()
    }

    /** Release waiters on the disposed worker and start a fresh epoch. */
    _end_runtime_epoch() {
        this._cancel_prefill()
        this._runtime_epoch++
        this._settling = Promise.resolve()
        this._epoch_ended.resolve()
        this._epoch_ended = deferred()
    }

    /**
     * Load a GGUF model from the browser cache.
     * New downloads live in Wllama's streaming OPFS cache; legacy IndexedDB
     * blobs remain supported so upgrades do not force a multi-GB re-download.
     * @param {string} model_id - The model ID in IndexedDB
     * @param {Function} [on_progress] - Progress callback
     * @returns {Promise<void>}
     */
    load_model( model_id, on_progress ) {

        // One load at a time: a second load would dispose the runtime the
        // first is still initialising
        const generation = this._load_generation
        const run = this._load_chain.then( () => {
            this._assert_load_current( generation )
            return this._load_model_now( model_id, on_progress, generation )
        } )
        this._load_chain = run.catch( () => {} )
        return run

    }

    /** Load body; callers go through load_model() so loads never interleave. */
    async _load_model_now( model_id, on_progress, generation ) {

        if( this._loaded_model_id === model_id && this._wllama?.isModelLoaded() ) {
            log.info( `[wllama] Model ${ model_id } already loaded, skipping reload` )
            if( on_progress ) on_progress( { progress: 1, status: `Model ready` } )
            return
        }

        if( this._wllama ) await this._release_model()
        await this._settling

        const db = await get_db()
        const cached = await db.get( `models`, model_id )

        if( !cached?.blob && !cached?.download_url && !cached?.file_handle ) {
            throw new Error( `Model ${ model_id } not found in cache` )
        }

        const model = await hydrate_cached_model( model_id, cached, db )
        let stored_model = null
        let storage_error = null

        try {
            if( cached.file_handle ) {
                const expected_size = model.file_size_bytes || cached.file_size_bytes
                stored_model = await get_external_model_file( cached.file_handle, expected_size )
            } else if( cached.download_url ) {
                // Catalog size wins over cached metadata so an interrupted
                // download cannot validate itself using its truncated length.
                const expected_size = model.file_size_bytes || cached.file_size_bytes
                stored_model = await get_browser_cached_model( cached.download_url, expected_size )
            }
        } catch ( error ) {
            storage_error = error
            log.warn( `[wllama] Could not access browser model storage:`, error )
        }

        if( cached.file_handle && storage_error ) throw storage_error

        if( ( cached.download_url || cached.file_handle ) && !stored_model ) {
            throw new Error( `Model files are missing from browser storage. Download the model again.` )
        }

        const model_blobs = cached.blob ? [ cached.blob ]
            : cached.file_handle ? [ stored_model ]
                : await stored_model.open()

        // Installs from before download checksums are hashed once; corrupt weights load fine, then babble
        await verify_installed_model( { cached, files: model_blobs, on_progress } )
        this._assert_load_current( generation )

        if( on_progress ) on_progress( { progress: 0, status: `Checking available memory...` } )

        // A vision model without its projector still chats; images wait for it
        const projector = projector_source( model ) ? await get_browser_cached_projector( model ).catch( error => {
            log.warn( `[wllama] Could not read the vision projector:`, error )
            return null
        } ) : null
        let image_blocked = projector_source( model ) && !projector ? `projector_missing` : null

        const capabilities = await detect_capabilities()
        this._assert_load_current( generation )
        const memory_budget = estimate_max_model_bytes( capabilities )
        const text_model = {
            ...model,
            file_size_bytes: model.file_size_bytes || cached.file_size_bytes || cached.blob?.size || 0,
        }
        const projector_bytes = projector ? projector_memory( model ) : 0
        const vision_model = { ...text_model, file_size_bytes: text_model.file_size_bytes + projector_bytes }
        const required_memory = estimate_model_memory( text_model )

        // Too tight for both (wasm32's 4 GiB, small phones): keep text chat
        const use_projector = projector && estimate_model_memory( vision_model, VISION_MIN_CONTEXT ) <= memory_budget
        if( projector && !use_projector ) {
            log.warn( `[wllama] Not enough memory for image input; loading ${ model_id } text-only` )
            image_blocked = `memory`
        }
        const fit_model = use_projector ? vision_model : text_model

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

        // Prefill is short and compute-bound: twice the decode threads lifts it
        // 45–65% (RunPod bench, wllama64 1.2.0) while decode stays memory-bound.
        // Phones keep one pool: big.LITTLE cores and thermals are unmeasured.
        const mobile = /Android|Mobile|iPhone|iPad/.test( navigator.userAgent || `` )
        const n_threads_batch = mobile ? n_threads : Math.min( hardware_threads, n_threads * 2 )
        const model_size = cached.file_size_bytes || model.file_size_bytes || 0

        // Near-ceiling models need compute-graph headroom more than prompt
        // throughput. A 512-token batch can add a large transient allocation
        // on top of 8–12 GB of weights.
        const n_batch = select_browser_batch( model_size, n_threads )
        const n_ctx = use_projector
            ? Math.max( VISION_MIN_CONTEXT, select_browser_context( fit_model, memory_budget ) )
            : select_browser_context( fit_model, memory_budget )
        const reasoning_enabled = cached.reasoning_enabled ?? model?.reasoning_enabled
        const file_size_mb = ( model_size / 1_000_000 ).toFixed( 0 )

        const load_options = {
            n_ctx,
            n_batch,
            n_threads,
            n_threads_batch,
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

            // A whole image must fit one prompt batch (see IMAGE_MAX_TOKENS)
            ... use_projector ? {
                image_min_tokens: IMAGE_MIN_TOKENS,
                image_max_tokens: IMAGE_MAX_TOKENS,
                n_batch: Math.max( n_batch, IMAGE_MAX_TOKENS ),
                n_ubatch: Math.max( n_batch, IMAGE_MAX_TOKENS ),
            } : {},
        }

        // wllama tells the projector apart by its GGUF architecture ("clip")
        const source = use_projector ? [ ...model_blobs, ...await projector.open() ] : model_blobs
        let probed_capabilities = capabilities

        // Mobile GPUs can compute wrong results in llama.cpp's WebGPU kernels
        const gpu_trusted = webgpu_offload_trusted( capabilities.gpu?.adapter_info )
        if( capabilities.gpu?.webgpu && !gpu_trusted ) {
            log.info( `[wllama] WebGPU offload not trusted on this GPU; loading on CPU` )

            // The capability hook may still hold probe buffers in shared memory
            await wait_for_existing_webgpu_memory_probe()
        }

        if( !this._gpu_disabled && gpu_trusted && capabilities.gpu?.webgpu ) {
            if( fit_model.block_count ) {
                if( on_progress ) on_progress( { progress: 0, status: `Measuring GPU memory...` } )
                probed_capabilities = await probe_capabilities_gpu_memory( capabilities )
            } else {
                // A capability hook may already hold large buffers on UMA.
                // Join it before loading a custom/legacy GGUF, but never start
                // a probe that cannot produce an offload layer count.
                await wait_for_existing_webgpu_memory_probe()
            }
        }

        this._assert_load_current( generation )
        let gpu_layers = this._gpu_disabled || !gpu_trusted ? 0 : select_gpu_offload_layers( {
            model: fit_model,
            adapter_class: classify_webgpu_adapter( probed_capabilities.gpu?.adapter_info ),
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
                if( gpu_error?.name === `LoadInterruptedError` ) throw gpu_error
                this._gpu_disabled = true
                gpu_layers = 0
                log.warn( `[wllama] GPU load failed; retrying ${ model_id } on CPU:`, gpu_error )
                if( on_progress ) on_progress( { progress: 0, status: `GPU unavailable — retrying safely on CPU...` } )
                await new Promise( resolve => setTimeout( resolve, 50 ) )

            }

        }

        if( !this._wllama?.isModelLoaded() ) {

            this._assert_load_current( generation )
            if( on_progress ) on_progress( { progress: 0, status: gpu_layers === 0 && this._gpu_disabled
                ? `Loading model with CPU fallback...`
                : `Loading model into memory...` } )

            try {
                const loaded = await this._load_cpu_runtime( source, load_options, model_size )
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

        // An unload during the load disposed the runtime it just created
        this._assert_load_current( generation )
        if( !this._wllama?.isModelLoaded() ) throw load_interrupted()

        if( !this._wllama.getChatTemplate() ) {
            await this._release_model()
            throw new Error( `This GGUF has no embedded chat template. Choose an instruct/chat model instead of a base model.` )
        }

        this._loaded_model_id = model_id
        const image_input = !!use_projector && this._wllama.supportInputModality( `image` )
        if( use_projector && !image_input ) log.warn( `[wllama] Projector loaded but ${ model_id } reports no image input` )
        this._capabilities = { image_input, image_blocked: image_input ? null : image_blocked, context_size: n_ctx }
        this._reload_context = {
            model_id,
            source,
            load_options,
            model_size,
        }

        const [ model_name, model_arch ] = this._model_identity()
        log.info( `[wllama] Ready: ${ model_name } (${ model_arch }, ${ runtime_name }${ image_input ? `, image input` : `` })` )

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

        this._cancel_prefill()
        await this._settling
        this._assert_ready()

        const started_at = performance.now()
        const wllama_messages = await this._prepare_messages( messages )
        let response

        try {
            response = await this._create_chat_completion( {
                messages: wllama_messages,
                ...this._build_completion_options( opts ),
            } )
        } catch ( error ) {
            if( this._gpu_layers <= 0 || !this._should_reload_on_cpu( error ) ) throw error
            await this._reload_on_cpu( error )
            response = await this._create_chat_completion( {
                messages: wllama_messages,
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
     * Streaming chat completion. Yields text deltas as strings, plus
     * `{ prompt_progress }` while the prompt is read and a final `{ timings }`.
     * A stop rejects with an AbortError at once, while the worker finishes its
     * current batch in the background; the next request waits for it.
     * @param {import('./types').ChatMessage[]} messages
     * @param {import('./types').GenerateOptions} [opts]
     * @returns {AsyncGenerator<string|{ prompt_progress: Object }|{ timings: Object }>}
     */
    async *chat_stream( messages, opts = {} ) {

        // A reply outranks a warm-up; it waits only for the batch in flight
        this._cancel_prefill()

        const abort_controller = new AbortController()
        const { signal } = abort_controller
        const epoch = this._runtime_epoch
        const epoch_ended = this._epoch_ended.promise
        const previous_request = Promise.race( [ this._settling, epoch_ended ] )
        this._abort_controller = abort_controller

        const started_at = performance.now()
        let first_token_at = null
        let token_count = 0
        let timings = null
        let emitted_text = false
        let pending_stream = null
        let iterator = null

        try {

            // A stopped predecessor may still occupy the worker's only slot
            await until_aborted( previous_request, signal )
            this._assert_ready()
            const wllama_messages = await until_aborted( this._prepare_messages( messages ), signal )

            pending_stream = this._create_chat_completion( {
                messages: wllama_messages,
                ...this._build_completion_options( opts ),
                stream: true,
                return_progress: true,
                abortSignal: signal,
            } )

            iterator = ( await until_aborted( pending_stream, signal ) )[ Symbol.asyncIterator ]()

            while( true ) {

                const { value: chunk, done } = await until_aborted( this._next_stream_chunk( iterator ), signal )
                if( done ) break

                if( chunk.prompt_progress && first_token_at === null ) yield { prompt_progress: chunk.prompt_progress }
                if( chunk.timings ) ( { timings } = chunk )

                const reported_tokens = chunk.usage?.completion_tokens || chunk.timings?.predicted_n
                if( reported_tokens ) token_count = reported_tokens

                const text = chunk.choices?.[ 0 ]?.delta?.content || ``
                if( text ) {
                    if( first_token_at === null ) first_token_at = performance.now()
                    emitted_text = true
                    yield text
                }

            }

            if( timings ) yield { timings }

            const elapsed_ms = performance.now() - started_at
            const ttft_ms = first_token_at === null ? elapsed_ms : first_token_at - started_at
            const tokens_per_second = timings?.predicted_per_second
                || token_count / ( Math.max( elapsed_ms - ttft_ms, 1 ) / 1000 )
            const [ model_name, model_arch ] = this._model_identity()

            log.info( `[wllama] [${ model_name } (${ model_arch })] ${ token_count } tokens — ttft ${ ttft_ms.toFixed( 0 ) }ms, ${ tokens_per_second.toFixed( 1 ) } tk/s` )

        } catch ( error ) {

            // Surface the stop to the caller; never mistake it for an empty reply
            if( signal.aborted || is_abort( error ) ) throw abort_error()

            if( this._gpu_layers > 0 && this._should_reload_on_cpu( error ) ) {
                await this._reload_on_cpu( error )
                if( signal.aborted ) throw abort_error()

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
            // A request from a disposed runtime must not block its replacement
            if( signal.aborted && this._runtime_epoch === epoch ) {
                const drained = this._drain( pending_stream, iterator, epoch, epoch_ended )
                this._settling = Promise.all( [ previous_request, drained ] )
            }
        }

    }

    /**
     * Read a prompt into llama.cpp's cache without answering it, so the next
     * reply to the same prefix only reads what changed. One sampled token is
     * the cheapest complete request. A newer prefill or any reply cancels this
     * one; the worker still finishes its current batch, and what it read
     * stays cached. Never throws: a warm-up that fails just warms nothing.
     * @param {import('./types').ChatMessage[]} messages
     * @returns {Promise<void>} Settles once the worker is free again
     */
    prefill( messages ) {

        this._prefill_controller?.abort()
        const controller = new AbortController()
        this._prefill_controller = controller

        const { signal } = controller
        const epoch = this._runtime_epoch
        const epoch_ended = this._epoch_ended.promise
        const previous_request = Promise.race( [ this._settling, epoch_ended ] )

        let pending_stream = null
        let iterator = null

        const run = ( async () => {

            const started_at = performance.now()

            try {

                await until_aborted( previous_request, signal )
                this._assert_ready()
                const wllama_messages = await until_aborted( this._prepare_messages( messages ), signal )

                pending_stream = this._create_chat_completion( {
                    messages: wllama_messages,
                    ...this._build_completion_options( { max_tokens: 1 } ),
                    stream: true,
                    abortSignal: signal,
                } )
                iterator = ( await until_aborted( pending_stream, signal ) )[ Symbol.asyncIterator ]()

                let timings = null
                while( true ) {
                    const { value: chunk, done } = await until_aborted( this._next_stream_chunk( iterator ), signal )
                    if( done ) break
                    if( chunk.timings ) ( { timings } = chunk )
                }

                log.debug( `[wllama] Prefilled ${ timings?.prompt_n ?? `?` } new tokens (${ timings?.cache_n ?? `?` } cached) in ${ ( performance.now() - started_at ).toFixed( 0 ) }ms` )

            } catch ( error ) {
                if( !signal.aborted && !is_abort( error ) ) log.debug( `[wllama] Prefill skipped:`, error?.message )
            } finally {
                if( this._prefill_controller === controller ) this._prefill_controller = null
                if( signal.aborted && this._runtime_epoch === epoch ) await this._drain( pending_stream, iterator, epoch, epoch_ended )
            }

        } )()

        // Whatever comes next waits for the worker this prefill, or the request
        // it queued behind, occupies; cancelling it while queued must not skip that
        this._settling = Promise.all( [ previous_request, run ] )
        return this._settling

    }

    /** Cancel a pending prefill; the next request waits for its current batch. */
    _cancel_prefill() {
        this._prefill_controller?.abort()
        this._prefill_controller = null
    }

    /**
     * Wait until an abandoned completion has left the worker. Wllama rejects
     * the stream with its own AbortError once the in-flight batch returns.
     * @param {Promise|null} pending_stream
     * @param {AsyncIterator|null} iterator
     * @returns {Promise<void>}
     */
    async _drain( pending_stream, iterator, epoch, epoch_ended ) {

        const started_at = performance.now()
        const drain = async () => {
            const stream_iterator = iterator || ( await pending_stream )?.[ Symbol.asyncIterator ]()
            while( stream_iterator && !( await stream_iterator.next() ).done ) { /* discard */ }
        }

        // Disposal ends the wait at once; a GPU batch also gets a deadline
        const waits = [ drain(), epoch_ended ]
        let timeout_id
        if( this._gpu_layers > 0 ) waits.push( new Promise( ( _, reject ) => {
            timeout_id = setTimeout( () => reject( new Error( `GPU inference stopped responding` ) ), GPU_TOKEN_TIMEOUT_MS )
        } ) )

        try {
            await Promise.race( waits )
        } catch ( error ) {

            // A wedged GPU never returns its batch. Retire only that runtime:
            // the next load starts fresh on CPU through the normal load path.
            if( /gpu inference stopped responding/i.test( error?.message || `` ) && this._runtime_epoch === epoch ) {
                log.warn( `[wllama] Stopped GPU request never returned; disposing its runtime` )
                this._gpu_disabled = true
                this._force_dispose_runtime( this._wllama, error )
                this._loaded_model_id = null
            }

            // Otherwise the expected AbortError, or a dead worker the next call reports

        } finally {
            clearTimeout( timeout_id )
        }

        log.debug( `[wllama] Stopped request released the worker after ${ ( performance.now() - started_at ).toFixed( 0 ) }ms` )

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
        this._load_generation++
        await this._release_model()
    }

    /** Dispose the runtime and forget the model, without cancelling queued loads. */
    async _release_model() {
        if( this._wllama ) log.info( `[wllama] Unloading model ${ this._loaded_model_id }` )
        await this._dispose_runtime()
        this._loaded_model_id = null
        this._capabilities = { image_input: false, image_blocked: null, context_size: 0 }
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

    /**
     * What the loaded model can read. `image_blocked` says why a vision model
     * has no image input: `projector_missing` (download it) or `memory`.
     * @returns {import('./types').ModelCapabilities}
     */
    get_capabilities() {
        return { ...this._capabilities }
    }

    /** Whether the loaded model reads images (same API as the Electron provider). */
    has_image_input() {
        return this._capabilities.image_input
    }

    /**
     * Turn app messages into wllama's shape. Without image input (e.g. after
     * switching from a vision model) history images become a short note
     * instead of failing every later turn.
     */
    _prepare_messages( messages ) {
        return to_wllama_messages( messages, this._capabilities.image_input ? MAX_HISTORY_IMAGES : 0 )
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

        // Compat (wllama 3.8.1) ignores n_threads_batch but would still spawn its pool
        if( compat ) load_options = { ...load_options, n_threads_batch: load_options.n_threads }

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
            // exit() never settles the pending load; disposal must end it too
            const disposed = this._epoch_ended.promise.then( () => {
                throw load_interrupted()
            } )
            await Promise.race( [
                runtime.loadModel( source, load_options ),
                worker_failure,
                timeout,
                disposed,
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

    /**
     * Load on CPU with the fast q8_0 KV cache, retrying once with f16. Quantized
     * KV needs head sizes divisible by 32, which some custom GGUFs lack.
     * @param {Blob[]|import('wllama64').Model} source
     * @param {Object} load_options
     * @param {number} model_size
     * @returns {Promise<{compat: boolean}>}
     */
    async _load_cpu_runtime( source, load_options, model_size ) {

        const fast_options = cpu_load_options( load_options )
        const generation = this._load_generation

        try {
            return await this._load_runtime_attempt( source, fast_options, model_size )
        } catch ( error ) {

            // Only a runtime rejection can be the cache type. More cache bytes
            // cannot cure out-of-memory, and a stalled worker needs no retry.
            const rejected_by_runtime = error instanceof WllamaError && error.type === `load_error`
            if( !rejected_by_runtime || is_memory_error( error ) ) throw error

            log.warn( `[wllama] q8_0 KV load failed, retrying with f16 KV:`, error?.message )
            await new Promise( resolve => setTimeout( resolve, 50 ) )
            this._assert_load_current( generation )
            return this._load_runtime_attempt( source, {
                ...fast_options,
                cache_type_k: `f16`,
                cache_type_v: `f16`,
            }, model_size )

        }

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

        if( this._wllama === runtime ) {
            this._wllama = null
            this._end_runtime_epoch()
        }

    }

    /** Convert the final CPU load failure into an actionable user error. */
    _friendly_load_error( load_error, model_id, file_size_mb ) {

        // Superseded loads are not failures; the caller decides what to show
        if( load_error?.name === `LoadInterruptedError` ) return load_error

        if( is_memory_error( load_error ) ) {
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
            await this._load_cpu_runtime( context.source, context.load_options, context.model_size )
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

        // exit() terminates the worker without settling its queued calls, so a
        // stopped request draining in the background would otherwise never end
        this._wllama = null
        this._end_runtime_epoch()
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
