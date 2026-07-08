import { Wllama } from '@wllama/wllama'
import { log } from 'mentie'
import { get_db } from '../stores/db'

// WASM paths — served from public/wasm/ (copied there by postinstall script)
const CONFIG_PATHS = {
    'single-thread/wllama.wasm': `/wasm/single-thread/wllama.wasm`,
    'multi-thread/wllama.wasm': `/wasm/multi-thread/wllama.wasm`,
}

const DEFAULT_BROWSER_CONTEXT = 2048
const FALLBACK_BROWSER_CONTEXT = 1024

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
    async load_model( model_id, on_progress ) {

        // Skip reload if this exact model is already loaded and healthy
        if( this._loaded_model_id === model_id && this._wllama?.isModelLoaded() ) {
            log.info( `[wllama] Model ${ model_id } already loaded, skipping reload` )
            if( on_progress ) on_progress( { progress: 1, status: `Model ready` } )
            return
        }

        // Unload any existing model first
        if( this._wllama ) await this.unload_model()

        // Create new wllama instance
        this._wllama = new Wllama( CONFIG_PATHS, {
            suppressNativeLog: true,
        } )

        // Retrieve model blob from IndexedDB
        const db = await get_db()
        const cached = await db.get( `models`, model_id )

        if( !cached?.blob ) {
            throw new Error( `Model ${ model_id } not found in cache` )
        }

        // Report initial progress
        if( on_progress ) {
            on_progress( { progress: 0, status: `Loading model into memory...` } )
        }

        // Use all but one core when SharedArrayBuffer is available. Without
        // cross-origin isolation, browsers cannot run the threaded WASM build.
        const hw_threads = navigator.hardwareConcurrency || 1
        const can_thread = window.crossOriginIsolated === true
        const n_threads = can_thread ? Math.max( 1, hw_threads - 1 ) : 1

        // Browser memory failures are often caused by oversized context/batch
        // settings rather than the GGUF file itself. Start with practical chat
        // defaults and retry smaller before surfacing an error.
        const n_ctx = Math.min( cached.context_length || DEFAULT_BROWSER_CONTEXT, DEFAULT_BROWSER_CONTEXT )
        const n_batch = n_threads > 1 ? 512 : 128

        const file_size_mb = ( cached.blob.size / 1_000_000 ).toFixed( 0 )
        log.info( `[wllama] Loading model ${ model_id } (${ file_size_mb } MB, ${ n_threads } threads, ctx ${ n_ctx }, batch ${ n_batch })` )

        const load_with_options = async ( options ) => {
            await this._wllama.loadModel( [ cached.blob ], {
                n_ctx: options.n_ctx,
                n_batch: options.n_batch,
                n_threads: options.n_threads,

                // Quantize the KV cache from FP16 → Q8_0.  Halves cache memory
                // with near-zero quality loss (+0.002 ppl), freeing headroom for
                // longer contexts or larger models within the WASM ceiling.
                cache_type_k: `q8_0`,
                cache_type_v: `q8_0`,
            } )
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
                this._wllama = null
                return
            }

            // WASM heap overflow produces a RangeError when the model is too large
            const is_memory_error = load_err instanceof RangeError
                || load_err.message?.includes( `memory` )
                || load_err.message?.includes( `out of bounds` )

            if( is_memory_error ) {
                log.warn( `[wllama] Memory pressure loading ${ model_id } (${ file_size_mb } MB), retrying safe mode` )

                try {
                    await this.unload_model()
                    this._wllama = new Wllama( CONFIG_PATHS, {
                        suppressNativeLog: true,
                    } )
                    await load_with_options( {
                        n_ctx: Math.min( cached.context_length || FALLBACK_BROWSER_CONTEXT, FALLBACK_BROWSER_CONTEXT ),
                        n_batch: 64,
                        n_threads: 1,
                    } )
                } catch ( fallback_err ) {
                    log.error( `[wllama] Out of memory loading ${ model_id } (${ file_size_mb } MB) after safe-mode retry`, fallback_err )
                    throw new Error( `This browser could not load the local model. Try reloading once, closing other tabs, or using the desktop app for local models.` )
                }
            } else {

                // Wllama's internal Glue protocol error — the WASM worker crashed or returned
                // a non-binary response (e.g. the C++ side hit OOM and sent a JSON error).
                // This typically means the model is too large for WebAssembly's 4 GB heap.
                const is_glue_error = load_err.message?.includes( `Invalid magic number` )
                    || load_err.message?.includes( `Invalid version number` )

                if( is_glue_error ) {
                    log.error( `[wllama] WASM worker protocol error loading ${ model_id } (${ file_size_mb } MB)` )
                    throw new Error( `Failed to load this model in the browser — it's likely too large for WebAssembly memory. Try a smaller quantization or use the desktop app.` )
                }

                log.error( `[wllama] Failed to load model:`, load_err )
                throw load_err
            }

        }

        this._loaded_model_id = model_id

        // Verify the tokenizer works — some GGUF files (e.g. QuantFactory conversions)
        // have broken tokenizer data that crashes the WASM runtime. Catching this
        // early gives the user a clear message instead of silent 0-token outputs.
        try {
            const probe_tokens = await this._wllama.tokenize( `Hello`, true )
            if( !probe_tokens?.length ) throw new Error( `empty` )
        } catch {
            await this.unload_model()
            throw new Error( `This model file has an incompatible tokenizer. Please delete it and re-download.` )
        }

        // Detect the chat template type and cache EOS/BOS token strings
        // so we can format prompts ourselves (wllama's formatChat has a bug
        // where eos_token is not provided to the Jinja template engine)
        const template = this._wllama.getChatTemplate()
        this._template_type = detect_template_type( template )
        log.info( `[wllama] Detected template type: ${ this._template_type }` )

        // Get EOS and BOS token strings by detokenizing their IDs
        // detokenize returns Uint8Array so we need to decode to string
        const decoder = new TextDecoder()
        try {
            const eos_id = this._wllama.getEOS()
            const bos_id = this._wllama.getBOS()
            const eot_id = this._wllama.getEOT()
            if( eos_id >= 0 ) this._eos_str = decoder.decode( await this._wllama.detokenize( [ eos_id ] ) )
            if( bos_id >= 0 ) this._bos_str = decoder.decode( await this._wllama.detokenize( [ bos_id ] ) )
            if( eot_id >= 0 ) this._eot_str = decoder.decode( await this._wllama.detokenize( [ eot_id ] ) )
            log.info( `[wllama] Tokens — EOS: ${ JSON.stringify( this._eos_str ) }, BOS: ${ JSON.stringify( this._bos_str ) }, EOT: ${ JSON.stringify( this._eot_str ) }` )
        } catch ( token_err ) {
            log.warn( `[wllama] Could not resolve special tokens, using defaults`, token_err )
        }

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
        const prompt = this._format_chat( messages )

        const t0 = performance.now()

        const response = await this._wllama.createCompletion( prompt, {
            nPredict: opts.max_tokens || 2048,
            sampling,
            stream: false,
            useCache: true,
        } )

        // Rough token estimate — wllama doesn't expose token count for non-streaming
        const elapsed_s = ( performance.now() - t0 ) / 1000
        const approx_tokens = response.split( /\s+/ ).length

        const [ model_name, model_arch ] = this._model_identity()
        log.info( `[wllama] [${ model_name } (${ model_arch })] Chat complete — ~${ approx_tokens } tokens in ${ elapsed_s.toFixed( 1 ) }s (~${ ( approx_tokens / elapsed_s ).toFixed( 1 ) } tk/s)` )

        return response

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

        // Use our own chat formatter which correctly includes EOS/BOS tokens
        // (wllama's formatChat has a bug where eos_token is not provided to the Jinja engine)
        const prompt = this._format_chat( messages )
        log.insane( `[wllama] Prompt (${ this._template_type }):\n`, prompt )

        const utf8 = new TextDecoder()
        let token_count = 0
        const t0 = performance.now()
        let ttft = null // time to first token

        const stream = await this._wllama.createCompletion( prompt, {
            nPredict: opts.max_tokens || 2048,
            sampling,
            stream: true,
            useCache: true,
            abortSignal: this._abort_controller.signal,
        } )

        try {

            for await ( const chunk of stream ) {

                token_count++

                // Decode raw token bytes in streaming mode — holds back incomplete
                // multi-byte UTF-8 sequences instead of emitting replacement chars
                const text = utf8.decode( chunk.piece, { stream: true } )
                if( text ) {

                    if( ttft === null ) ttft = performance.now() - t0
                    yield text
                }

            }

            // Flush any bytes the streaming decoder held back
            const trailing = utf8.decode()
            if( trailing ) yield trailing

            // Performance summary for this generation
            const elapsed_ms = performance.now() - t0

            const [ model_name, model_arch ] = this._model_identity()

            if( token_count > 0 ) {

                // tk/s excludes the prompt processing time (TTFT) so it reflects
                // pure decode throughput — the number the user "feels"
                const decode_ms = elapsed_ms - ( ttft || 0 )
                const tks = decode_ms > 0 ? ( token_count / ( decode_ms / 1000 ) ).toFixed( 1 ) : `∞`

                log.info(
                    `[wllama] [${ model_name } (${ model_arch })] ${ token_count } tokens — ttft ${ ttft.toFixed( 0 ) }ms, ${ tks } tk/s (${ ( elapsed_ms / 1000 ).toFixed( 1 ) }s total)`
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
