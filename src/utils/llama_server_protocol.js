/**
 * llama.cpp `llama-server` protocol — shared by the desktop sidecar
 * (electron/llama_server.js) and the mobile apps (src/native/), which run the
 * same upstream server natively. Pure functions only: no Node or DOM APIs.
 */

// Dynamic-resolution encoders (Qwen) can turn one large screenshot into
// thousands of tokens; cap it so a single image cannot eat the context.
export const IMAGE_MAX_TOKENS = 1024

// Non-causal vision encoders (Gemma) need a whole image in one micro-batch
export const UBATCH_SIZE = 1024

/**
 * On-disk name for a vision projector. Hugging Face repos all call theirs
 * `mmproj-F16.gguf`, so prefix the model's own file stem to keep them apart.
 * @param {string} model_file_name - e.g. `Qwen3.5-2B-Q4_K_M.gguf`
 * @param {string} mmproj_file_name - e.g. `mmproj-F16.gguf`
 * @returns {string} e.g. `Qwen3.5-2B-Q4_K_M.mmproj-F16.gguf`
 */
export const mmproj_local_name = ( model_file_name, mmproj_file_name ) => {
    const stem = model_file_name.replace( /\.gguf$/i, `` )
    const base = mmproj_file_name.split( `/` ).pop()
    return `${ stem }.${ base }`
}

/**
 * Build the llama-server command line.
 * GPU layers are left at llama.cpp's default (`auto` + `--fit on`), which
 * offloads as much as fits on Metal/Vulkan and silently runs on CPU otherwise.
 * @param {Object} params
 * @param {string} params.model_path
 * @param {string} [params.mmproj_path] - Vision projector; omitted for text-only models
 * @param {number} params.n_ctx
 * @param {number} params.port
 * @param {string} params.api_key
 * @param {boolean} [params.cpu_only] - Skip every GPU backend (crash fallback, phones)
 * @param {string[]} [params.extra] - Device-specific tuning (threads, CPU mask)
 * @returns {string[]}
 */
export const build_server_args = ( { model_path, mmproj_path, n_ctx, port, api_key, cpu_only = false, extra = [] } ) => [

    `--model`, model_path,
    ... mmproj_path ? [ `--mmproj`, mmproj_path ] : [],
    `--ctx-size`, String( n_ctx ),

    // Private loopback server: random port + per-launch key, no web UI
    `--host`, `127.0.0.1`,
    `--port`, String( port ),
    `--api-key`, api_key,
    `--no-webui`,

    // One chat at a time gets the whole context
    `--parallel`, `1`,

    // GGUF's own Jinja template; keep <think> markup in content (the UI parses it)
    `--jinja`,
    `--reasoning-format`, `none`,

    ... mmproj_path ? [ `--image-max-tokens`, String( IMAGE_MAX_TOKENS ) ] : [],
    `--ubatch-size`, String( UBATCH_SIZE ),

    ... cpu_only ? [ `--device`, `none`, ... mmproj_path ? [ `--no-mmproj-offload` ] : [] ] : [],

    ...extra,

]

/**
 * Base64 of raw bytes, in Node (Buffer) and browsers (btoa) alike
 * @param {Uint8Array} bytes
 * @returns {string}
 */
const to_base64 = ( bytes ) => {

    if( typeof Buffer !== `undefined` ) return Buffer.from( bytes ).toString( `base64` )

    // Chunked: String.fromCharCode cannot take a multi-MB argument list
    let binary = ``
    for( let index = 0; index < bytes.length; index += 0x8000 ) {
        binary += String.fromCharCode( ...bytes.subarray( index, index + 0x8000 ) )
    }
    return btoa( binary )

}

/**
 * Turn raw image bytes into a base64 data URI
 * @param {ArrayBuffer|Uint8Array|string} data - Bytes, or an existing data URI
 * @param {string} mime
 * @returns {string}
 */
export const to_data_uri = ( data, mime = `image/png` ) => {

    if( typeof data === `string` ) return data.startsWith( `data:` ) ? data : `data:${ mime };base64,${ data }`

    const bytes = data instanceof ArrayBuffer ? new Uint8Array( data ) : data
    return `data:${ mime };base64,${ to_base64( bytes ) }`

}

/**
 * Convert renderer chat messages to OpenAI chat format.
 * User messages with image attachments become content parts (images first,
 * then text); document chips and anything without bytes are dropped.
 * @param {Array<{ role: string, content: string, attachments?: Array }>} messages
 * @returns {Array<{ role: string, content: string|Array }>}
 */
export const to_openai_messages = ( messages ) => messages.map( ( { role, content = ``, attachments = [] } ) => {

    const images = role === `user` ? attachments.filter( ( { kind, data } ) => kind === `image` && data ) : []
    if( !images.length ) return { role, content }

    return {
        role,
        content: [
            ...images.map( ( { data, mime } ) => ( { type: `image_url`, image_url: { url: to_data_uri( data, mime ) } } ) ),
            ... content ? [ { type: `text`, text: content } ] : [],
        ],
    }

} )

/**
 * Build the /v1/chat/completions request body from app generation options
 * (same defaults as the wllama provider).
 * @param {Array} messages - Renderer messages
 * @param {Object} [opts] - GenerateOptions
 * @param {Object} [model] - { reasoning_enabled }
 * @returns {Object}
 */
export const build_request_body = ( messages, opts = {}, { reasoning_enabled } = {} ) => ( {
    messages: to_openai_messages( messages ),
    stream: true,
    return_progress: true,
    cache_prompt: true,
    max_tokens: opts.max_tokens ?? 2048,
    temperature: opts.temperature ?? 0.7,
    top_p: opts.top_p ?? 0.95,
    top_k: opts.top_k ?? 40,
    min_p: opts.min_p ?? 0.05,
    repeat_penalty: opts.repeat_penalty ?? 1.1,
    repeat_last_n: opts.repeat_last_n ?? 64,
    frequency_penalty: opts.frequency_penalty ?? 0,
    presence_penalty: opts.presence_penalty ?? 0,
    ... opts.seed !== undefined && opts.seed !== -1 ? { seed: opts.seed } : {},
    ... opts.stop_sequences?.length ? { stop: opts.stop_sequences } : {},
    // Only override the template when the model declares a deliberate default
    ... reasoning_enabled !== undefined ? { chat_template_kwargs: { enable_thinking: reasoning_enabled } } : {},
} )

/**
 * Incremental Server-Sent Events parser. Feed it decoded text; it calls
 * `on_data` with each parsed JSON payload and ignores `[DONE]` / comments.
 * @param {( payload: Object ) => void} on_data
 * @returns {( text: string ) => void}
 */
export const create_sse_parser = ( on_data ) => {

    let buffer = ``

    return ( text ) => {
        buffer += text
        const lines = buffer.split( /\r?\n/ )
        buffer = lines.pop()
        for( const line of lines ) {
            if( !line.startsWith( `data:` ) ) continue
            const data = line.slice( 5 ).trim()
            if( !data || data === `[DONE]` ) continue
            on_data( JSON.parse( data ) )
        }
    }

}

/**
 * Pick a context size from the model's architecture and a memory budget.
 *
 * KV cache cost per token comes from the model's layers / kv_heads / head_dim;
 * whatever the budget leaves after weights (+ projector) and runtime overhead
 * becomes context, clamped to the model's advertised context_length. Without
 * architecture data (custom imports) the model's own context is requested.
 * Never below 2048 otherwise: the server's own fit logic catches overestimates.
 *
 * @param {Object} model - Manifest entry
 * @param {number} budget_bytes - Memory the model may use in total
 * @param {Object} [options]
 * @param {number} [options.overhead_bytes] - Runtime overhead outside the model
 * @param {number} [options.max_ctx] - Hard cap (phones keep prompts short to stay fast)
 * @returns {number} Context size to request
 */
export const estimate_context_size = ( model, budget_bytes, { overhead_bytes = 500_000_000, max_ctx = Infinity } = {} ) => {

    const FALLBACK = 2048
    const model_ctx = Math.min( model.context_length || FALLBACK, max_ctx )

    if( !model.layers || !model.kv_heads || !model.head_dim ) return model_ctx

    // KV cache = 2 (key + value) × layers × kv_heads × head_dim × 2 bytes (FP16) per token
    const kv_per_token = 2 * model.layers * model.kv_heads * model.head_dim * 2

    // The vision projector lives in the same memory as the weights
    const weights_bytes = ( model.file_size_bytes || 0 ) + ( model.mmproj_size_bytes || 0 )
    const available = budget_bytes - weights_bytes - overhead_bytes

    if( available <= 0 ) return FALLBACK

    // Round down to nearest 256 for clean alignment
    const estimated = Math.floor( available / kv_per_token / 256 ) * 256

    return Math.max( FALLBACK, Math.min( model_ctx, estimated ) )

}
