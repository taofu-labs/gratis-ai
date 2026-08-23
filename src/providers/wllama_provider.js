import { Wllama } from 'wllama64'
import { log } from 'mentie'
import { get_db } from '../stores/db'
import {
    apply_thinking_preference_to_messages,
    get_thinking_chat_template_kwargs,
    supports_thinking_control,
} from '../utils/thinking_mode'

// WASM paths — served from public/wasm/ (copied there by postinstall script)
const CONFIG_PATHS = {
    default: `/wasm/wllama.wasm`,
}

const DEFAULT_BROWSER_CONTEXT = 2048
const BROWSER_LOAD_TIMEOUT_MS = 120_000
const FIRST_TOKEN_TIMEOUT_MS = 120_000

const delay = ( ms ) => new Promise( resolve => setTimeout( resolve, ms ) )

const timeout_error = ( message, name ) => Object.assign( new Error( message ), { name } )

const with_timeout = async ( promise, ms, message, name ) => {

    let timer = null
    const timeout = new Promise( ( _, reject ) => {
        timer = setTimeout( () => reject( timeout_error( message, name ) ), ms )
    } )

    try {
        return await Promise.race( [ promise, timeout ] )
    } finally {
        if( timer ) clearTimeout( timer )
    }

}

const extract_chat_chunk_text = ( chunk ) => {

    const choice = chunk?.choices?.[ 0 ] || {}
    const delta = choice.delta || {}

    const content = delta.content ?? choice.text ?? chunk.content ?? chunk.text ?? chunk.response
    if( typeof content === `string` && content ) return { text: content, kind: `content` }

    const reasoning = delta.reasoning_content
        ?? delta.reasoning
        ?? choice.reasoning_content
        ?? choice.reasoning
        ?? chunk.reasoning_content
        ?? chunk.reasoning

    if( typeof reasoning === `string` && reasoning ) return { text: reasoning, kind: `reasoning` }

    return { text: ``, kind: null }

}

/**
 * Detect which chat template family a Jinja template belongs to.
 * Returns a string key used by format_chat_prompt to pick the right formatter.
 * @param {string} template - Jinja template from GGUF metadata
 * @returns {'zephyr' | 'chatml' | 'mistral' | 'llama3' | 'unknown'}
 */
const detect_template_type = ( template ) => {

    if( !template ) return `unknown`

    // Zephyr / TinyLlama — uses <|user|>, <|system|>, <|assistant|> with eos_token
    if( template.includes( `<|user|>` ) && template.includes( `eos_token` ) ) return `zephyr`

    // ChatML — uses <|im_start|> and <|im_end|>
    if( template.includes( `<|im_start|>` ) ) return `chatml`

    // Llama 3 — uses <|start_header_id|>
    if( template.includes( `<|start_header_id|>` ) ) return `llama3`

    // Mistral — uses [INST] and [/INST]
    if( template.includes( `[INST]` ) ) return `mistral`

    return `unknown`

}

/**
 * Manually format chat messages into a prompt string.
 * Bypasses wllama's formatChat which has a bug where eos_token
 * is not provided to the Jinja template engine, producing broken prompts.
 * @param {Array<{role: string, content: string}>} messages
 * @param {string} eos_token - The EOS token string (e.g., "</s>")
 * @param {string} bos_token - The BOS token string (e.g., "<s>")
 * @param {string} eot_token - The EOT (end-of-turn) token string (e.g., "<|eot_id|>")
 * @param {string} template_type - One of the detected template types
 * @returns {string} Formatted prompt ready for completion
 */
const format_chat_prompt = ( messages, eos_token, bos_token, eot_token, template_type ) => {

    let prompt = ``

    switch ( template_type ) {

    // Zephyr format — used by TinyLlama, Zephyr, StableLM
    case `zephyr`:
        for( const { role, content } of messages ) {
            prompt += `<|${ role }|>\n${ content }${ eos_token }`
        }
        prompt += `<|assistant|>\n`
        break

        // ChatML format — used by SmolLM2, Qwen, many fine-tunes
    case `chatml`:
        for( const { role, content } of messages ) {
            prompt += `<|im_start|>${ role }\n${ content }<|im_end|>\n`
        }
        prompt += `<|im_start|>assistant\n`
        break

        // Llama 3 format — uses header IDs
    case `llama3`:
        prompt += `<|begin_of_text|>`
        for( const { role, content } of messages ) {
            prompt += `<|start_header_id|>${ role }<|end_header_id|>\n\n${ content }${ eot_token }`
        }
        prompt += `<|start_header_id|>assistant<|end_header_id|>\n\n`
        break

        // Mistral format — [INST] wrapping
    case `mistral`: {
        // Mistral puts system prompt before the first [INST] if present
        const system_msg = messages.find( m => m.role === `system` )
        const non_system = messages.filter( m => m.role !== `system` )
        // BOS only once at the start, not before every [INST]
        prompt += bos_token
        let turn_idx = 0

        for( const { role, content } of non_system ) {
            if( role === `user` ) {
                prompt += `[INST] `
                // Prepend system prompt to the first user message
                if( system_msg && turn_idx === 0 ) {
                    prompt += `${ system_msg.content }\n\n`
                }
                prompt += `${ content } [/INST]`
                turn_idx++
            } else if( role === `assistant` ) {
                prompt += ` ${ content }${ eos_token }`
            }
        }
        break
    }

    // Fallback — simple concatenation with role markers
    default:
        for( const { role, content } of messages ) {
            prompt += `### ${ role }:\n${ content }\n`
        }
        prompt += `### assistant:\n`
        break

    }

    return prompt

}

/**
 * Browser-based LLM provider using wllama (WASM llama.cpp)
 * Implements the LLMProvider interface from types.js
 */
export default class WllamaProvider {

    constructor() {
        this._wllama = null
        this._loaded_model_id = null
        this._loaded_context_length = null
        this._abort_controller = null
        this._template_type = `unknown`
        this._eos_str = `</s>`
        this._bos_str = `<s>`
        this._eot_str = ``
    }

    /**
     * Load a GGUF model from IndexedDB cache
     * @param {string} model_id - The model ID in IndexedDB
     * @param {Function} [on_progress] - Progress callback
     * @returns {Promise<void>}
     */
    async load_model( model_id, on_progress, options = {} ) {

        const requested_context_override = options.context_length ?? null

        // Skip reload if this exact model is already loaded and healthy
        if(
            this._loaded_model_id === model_id
            && this._loaded_context_length === requested_context_override
            && this._wllama?.isModelLoaded()
        ) {
            log.info( `[wllama] Model ${ model_id } already loaded, skipping reload` )
            if( on_progress ) on_progress( { progress: 1, status: `Model ready` } )
            return
        }

        // Unload any existing model first
        if( this._wllama ) await this.unload_model()

        // Retrieve model blob from IndexedDB
        const db = await get_db()
        const cached = await db.get( `models`, model_id )

        if( !cached?.blob ) {
            throw new Error( `Model ${ model_id } not found in cache` )
        }

        // Create new wllama instance
        this._wllama = new Wllama( CONFIG_PATHS, {
            suppressNativeLog: true,
        } )
        this._wllama.setCompat?.( null )

        // Report initial progress
        if( on_progress ) {
            on_progress( { progress: 0, status: `Loading model into memory...` } )
        }

        // Use all but one core when SharedArrayBuffer is available. Without
        // cross-origin isolation, browsers cannot run the threaded WASM build.
        const hw_threads = navigator.hardwareConcurrency || 1
        const can_thread = window.crossOriginIsolated === true
        const n_threads = can_thread ? Math.max( 1, hw_threads - 1 ) : 1

        // If the user explicitly selected a context, honor it. Otherwise use a
        // conservative browser default for catalog models with very large max ctx.
        const has_context_override = Number.isFinite( options.context_length ) && options.context_length > 0
        const requested_context = has_context_override ? options.context_length : cached.context_length || DEFAULT_BROWSER_CONTEXT
        const context_ceiling = has_context_override ? requested_context : DEFAULT_BROWSER_CONTEXT
        const n_ctx = Math.min( requested_context, cached.context_length || requested_context, context_ceiling )
        const n_batch = n_threads > 1 ? 512 : 128
        // Keep browser loads on the proven WASM path for now. WebGPU offload can
        // make large custom models freeze during init on integrated GPUs.
        const n_gpu_layers = 0

        const file_size_mb = ( cached.blob.size / 1_000_000 ).toFixed( 0 )
        log.info( `[wllama] Loading model ${ model_id } (${ file_size_mb } MB, ${ n_threads } threads, ctx ${ n_ctx }, batch ${ n_batch }, gpu ${ n_gpu_layers > 0 ? `on` : `off` })` )

        const cleanup_timers = ( timers ) => {
            timers.forEach( timer => clearTimeout( timer ) )
            timers.length = 0
        }

        const schedule_load_status = ( timers, status, ms ) => {
            if( !on_progress ) return
            timers.push( setTimeout( () => {
                on_progress( { progress: 0, status } )
            }, ms ) )
        }

        const load_with_options = async ( options ) => {
            const timers = []
            if( on_progress ) {
                on_progress( { progress: 0, status: `Loading ${ n_ctx.toLocaleString() } context into browser memory...` } )
            }

            schedule_load_status( timers, `Still loading the model into WebAssembly...`, 10_000 )
            schedule_load_status( timers, `Large browser models can pause the tab while memory is prepared...`, 30_000 )
            schedule_load_status( timers, `Still waiting on the browser runtime. If this continues, pick a smaller quantization or context.`, 60_000 )

            const timeout = new Promise( ( _, reject ) => {
                timers.push( setTimeout( () => {
                    reject( timeout_error(
                        `The browser did not finish loading this model after 2 minutes. Pick a smaller quantization or lower context, then try again.`,
                        `LoadTimeoutError`
                    ) )
                }, BROWSER_LOAD_TIMEOUT_MS ) )
            } )

            try {
                await Promise.race( [ this._wllama.loadModel( [ cached.blob ], {
                    n_ctx: options.n_ctx,
                    n_batch: options.n_batch,
                    n_threads: options.n_threads,
                    n_gpu_layers,

                    // Quantize the KV cache from FP16 → Q8_0.  Halves cache memory
                    // with near-zero quality loss (+0.002 ppl), freeing headroom for
                    // longer contexts or larger models within the WASM ceiling.
                    cache_type_k: `q8_0`,
                    cache_type_v: `q8_0`,
                } ), timeout ] )
            } finally {
                cleanup_timers( timers )
            }
        }

        try {

            await load_with_options( { n_ctx, n_batch, n_threads } )

        } catch ( load_err ) {

            // "Module is already initialized" — a concurrent load booted
            // the WASM runtime before this call could. Safe to bail out:
            // the winning call will complete the load and the store's dedup
            // will surface its result to all callers.
            if( load_err.message?.includes( `already initialized` ) ) {
                log.warn( `[wllama] Module already initialized — concurrent load detected, deferring` )
                await this.unload_model()
                throw new Error( `Model load was interrupted by another load. Try again.` )
            }

            if( load_err.name === `LoadTimeoutError` ) {
                log.error( `[wllama] Timed out loading ${ model_id } (${ file_size_mb } MB, ctx ${ n_ctx })` )
                const stuck_runtime = this._wllama
                this._wllama = null
                if( stuck_runtime ) {
                    await Promise.race( [
                        stuck_runtime.exit().catch( () => {} ),
                        delay( 1_000 ),
                    ] )
                }
                throw load_err
            }

            // WASM heap overflow produces a RangeError when the model is too large
            const is_memory_error = load_err instanceof RangeError
                || load_err.message?.includes( `memory` )
                || load_err.message?.includes( `out of bounds` )

            if( is_memory_error ) {
                log.warn( `[wllama] Memory pressure loading ${ model_id } (${ file_size_mb } MB, ctx ${ n_ctx })` )

                const can_retry_same_context = n_threads > 1 || n_batch > 64

                if( can_retry_same_context ) {
                    try {
                        await this.unload_model()
                        this._wllama = new Wllama( CONFIG_PATHS, {
                            suppressNativeLog: true,
                        } )
                        this._wllama.setCompat?.( null )
                        if( on_progress ) {
                            on_progress( { progress: 0, status: `Retrying ${ n_ctx.toLocaleString() } context in safe mode...` } )
                        }
                        await load_with_options( {
                            n_ctx,
                            n_batch: 64,
                            n_threads: 1,
                        } )
                    } catch ( fallback_err ) {
                        log.error( `[wllama] Out of memory loading ${ model_id } (${ file_size_mb } MB, ctx ${ n_ctx })`, fallback_err )
                        throw new Error( `Could not load this model at ${ n_ctx.toLocaleString() } context in this browser. Try a smaller context or a smaller quantization.` )
                    }
                } else {
                    throw new Error( `Could not load this model at ${ n_ctx.toLocaleString() } context in this browser. Try a smaller context or a smaller quantization.` )
                }
            } else {

                // Wllama's internal Glue protocol error — the WASM worker crashed or returned
                // a non-binary response (e.g. the C++ side hit OOM and sent a JSON error).
                // This typically means the model is too large for WebAssembly's 4 GB heap.
                const is_glue_error = load_err.message?.includes( `Invalid magic number` )
                    || load_err.message?.includes( `Invalid version number` )

                if( is_glue_error ) {
                    log.error( `[wllama] WASM worker protocol error loading ${ model_id } (${ file_size_mb } MB)` )
                    throw new Error( `The browser runtime crashed while loading this model. It may be too large for WebAssembly memory or use an unsupported GGUF architecture. Try lower context, smaller quantization, or another model.` )
                }

                const message = load_err.message || ``
                const is_unsupported_model = /unsupported|unknown architecture|unknown model|not supported|tensor.+not found|unknown tensor|gated.?delta|ssm/i.test( message )

                if( is_unsupported_model ) {
                    log.error( `[wllama] Unsupported browser model loading ${ model_id } (${ file_size_mb } MB): ${ message }` )
                    throw new Error( `This model is not supported by the browser runtime yet. Try another GGUF model or use the desktop app.` )
                }

                log.error( `[wllama] Failed to load model:`, load_err )
                throw load_err
            }

        }

        this._loaded_model_id = model_id
        this._loaded_context_length = requested_context_override

        // Detect chat template type for diagnostics. Prompt rendering itself is
        // handled by Wllama v3's chat-completion API.
        const template = this._wllama.getChatTemplate()
        this._template_type = detect_template_type( template )
        log.info( `[wllama] Detected template type: ${ this._template_type }` )

        // Update last_used_at timestamp — non-critical, don't fail the load if storage is full
        try {
            await db.put( `models`, { ...cached, last_used_at: Date.now() } )
        } catch {
            log.warn( `[wllama] Could not update last_used_at (storage quota may be full)` )
        }

        if( on_progress ) {
            on_progress( { progress: 1, status: `Model ready` } )
        }

    }

    /**
     * Format chat messages into a prompt string.
     * Uses our own formatter to work around wllama's eos_token bug.
     * @param {Array<{role: string, content: string}>} messages
     * @returns {string} Formatted prompt
     */
    _format_chat( messages ) {
        return format_chat_prompt( messages, this._eos_str, this._bos_str, this._eot_str, this._template_type )
    }

    /**
     * Apply Qwen thinking controls only for models that understand them.
     * @param {import('./types').ChatMessage[]} messages
     * @param {import('./types').GenerateOptions} opts
     * @returns {{messages: import('./types').ChatMessage[], chat_template_kwargs?: Object}}
     */
    _build_thinking_request( messages, opts ) {

        if( !this._supports_thinking_control() ) return { messages }

        return {
            messages: apply_thinking_preference_to_messages( messages, opts.thinking_enabled === true ),
            chat_template_kwargs: get_thinking_chat_template_kwargs( messages, opts.thinking_enabled === true ),
        }

    }

    /**
     * Single-shot chat completion
     * @param {import('./types').ChatMessage[]} messages
     * @param {import('./types').GenerateOptions} [opts]
     * @returns {Promise<string>}
     */
    async chat( messages, opts = {} ) {

        if( !this._wllama || !this._wllama.isModelLoaded() ) {
            throw new Error( `No model loaded` )
        }

        const sampling = this._build_sampling( opts )
        const thinking_request = this._build_thinking_request( messages, opts )

        const t0 = performance.now()

        const response = await this._wllama.createChatCompletion( {
            ...thinking_request,
            max_tokens: opts.max_tokens || 2048,
            stream: false,
            cache_prompt: true,
            ...sampling,
        } )

        const text = response.choices[ 0 ]?.message?.content || ``
        const elapsed_s = ( performance.now() - t0 ) / 1000
        const approx_tokens = response.usage?.completion_tokens || text.split( /\s+/ ).length

        const [ model_name, model_arch ] = this._model_identity()
        log.info( `[wllama] [${ model_name } (${ model_arch })] Chat complete — ~${ approx_tokens } tokens in ${ elapsed_s.toFixed( 1 ) }s (~${ ( approx_tokens / elapsed_s ).toFixed( 1 ) } tk/s)` )

        return text

    }

    /**
     * Streaming chat completion — yields tokens as they are generated.
     * Uses our own chat formatter + createCompletion for reliability.
     * @param {import('./types').ChatMessage[]} messages
     * @param {import('./types').GenerateOptions} [opts]
     * @returns {AsyncGenerator<string>}
     */
    async *chat_stream( messages, opts = {} ) {

        if( !this._wllama || !this._wllama.isModelLoaded() ) {
            throw new Error( `No model loaded` )
        }

        this._abort_controller = new AbortController()
        const sampling = this._build_sampling( opts )
        const thinking_request = this._build_thinking_request( messages, opts )
        let token_count = 0
        const t0 = performance.now()
        let ttft = null // time to first token
        let reasoning_open = false

        const first_token_timeout_message = `The model did not start responding after 2 minutes. Try a smaller context, smaller quantization, or a shorter prompt.`

        const stream = await with_timeout( this._wllama.createChatCompletion( {
            ...thinking_request,
            max_tokens: opts.max_tokens || 2048,
            stream: true,
            cache_prompt: true,
            abortSignal: this._abort_controller.signal,
            ...sampling,
        } ), FIRST_TOKEN_TIMEOUT_MS, first_token_timeout_message, `GenerationTimeoutError` )

        try {

            const iterator = stream[ Symbol.asyncIterator ]()

            while( true ) {

                const next = token_count === 0
                    ? await with_timeout( iterator.next(), FIRST_TOKEN_TIMEOUT_MS, first_token_timeout_message, `GenerationTimeoutError` )
                    : await iterator.next()

                if( next.done ) break

                const chunk = next.value
                const { text, kind } = extract_chat_chunk_text( chunk )

                if( text ) {

                    const visible_text = kind === `reasoning`
                        ? `${ reasoning_open ? `` : `<think>` }${ text }`
                        : `${ reasoning_open ? `</think>\n\n` : `` }${ text }`

                    if( kind === `reasoning` ) reasoning_open = true
                    else reasoning_open = false

                    token_count++
                    if( ttft === null ) ttft = performance.now() - t0
                    yield visible_text
                }

            }

            if( reasoning_open ) yield `</think>\n\n`

            // Performance summary for this generation
            const elapsed_ms = performance.now() - t0

            const [ model_name, model_arch ] = this._model_identity()

            if( token_count > 0 ) {

                // tk/s excludes the prompt processing time (TTFT) so it reflects
                // pure decode throughput — the number the user "feels"
                const decode_ms = elapsed_ms - ( ttft || 0 )
                const tks = decode_ms > 0 ? ( token_count / ( decode_ms / 1000 ) ).toFixed( 1 ) : `∞`

                log.info(
                    `[wllama] [${ model_name } (${ model_arch })] ${ token_count } chunks — ttft ${ ttft.toFixed( 0 ) }ms, ${ tks } chunk/s (${ ( elapsed_ms / 1000 ).toFixed( 1 ) }s total)`
                )

            } else {
                log.warn( `[wllama] [${ model_name }] Model generated 0 tokens. Template type: ${ this._template_type }` )
            }

        } catch ( err ) {
            // Don't re-throw abort errors
            if( err.name === `AbortError` || err.message?.includes( `abort` ) ) return
            throw err
        } finally {
            this._abort_controller = null
        }

    }

    /**
     * Abort any in-progress generation
     */
    abort() {
        if( this._abort_controller ) {
            this._abort_controller.abort()
            this._abort_controller = null
        }
    }

    /**
     * Unload the current model from memory
     * @returns {Promise<void>}
     */
    async unload_model() {

        if( this._wllama ) {
            log.info( `[wllama] Unloading model ${ this._loaded_model_id }` )
            try {
                await this._wllama.exit()
            } catch {
                // Ignore errors during cleanup
            }
            this._wllama = null
        }
        this._loaded_model_id = null
        this._loaded_context_length = null

    }

    /**
     * Get the currently loaded model ID
     * @returns {string|null}
     */
    get_loaded_model() {
        return this._loaded_model_id
    }

    /**
     * Check if a model is loaded and ready
     * @returns {boolean}
     */
    is_ready() {
        return !!this._wllama && this._wllama.isModelLoaded()
    }

    /**
     * Read the actual model identity from GGUF metadata.
     * Returns [name, architecture] — never assumes the catalog ID matches.
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
     * Check whether the loaded model should receive Qwen thinking controls.
     * @returns {boolean}
     */
    _supports_thinking_control() {

        const meta = this._wllama?.getModelMetadata()?.meta || {}

        return supports_thinking_control( {
            model_id: this._loaded_model_id,
            name: meta[`general.name`],
            architecture: meta[`general.architecture`],
            chat_template: this._wllama?.getChatTemplate?.(),
        } )

    }

    /**
     * Build wllama sampling config from GenerateOptions
     * @param {import('./types').GenerateOptions} opts
     * @returns {Object} Wllama SamplingConfig
     */
    _build_sampling( opts ) {

        const sampling = {
            temp: opts.temperature ?? 0.7,
            top_p: opts.top_p ?? 0.95,
            top_k: opts.top_k ?? 40,
            min_p: opts.min_p ?? 0.05,
            penalty_repeat: opts.repeat_penalty ?? 1.1,
            penalty_last_n: opts.repeat_last_n ?? 64,
            penalty_freq: opts.frequency_penalty ?? 0,
            penalty_present: opts.presence_penalty ?? 0,
        }

        // Wire seed for reproducible outputs (-1 means random, omit it)
        if( opts.seed !== undefined && opts.seed !== -1 ) sampling.seed = opts.seed

        return sampling

    }

}
