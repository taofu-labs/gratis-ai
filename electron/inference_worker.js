/**
 * Inference worker — runs in an Electron utilityProcess so that heavy
 * native model loading and token generation never block the main process
 * (and therefore never freeze the UI).
 *
 * Communication is via structured messages on `process.parentPort`:
 *   → { id, type, payload }   (request from main)
 *   ← { id, type, payload }   (response back)
 *   ← { type: 'stream-token', payload }  (unsolicited stream events)
 *   ← { type: 'stream-done' }
 */

const os = require( `os` )

const THINKING_DIRECTIVE_RE = /(^|\s)\/(no[\s_-]?think|think)(?=$|\s|[.!?,;:])/i

const get_explicit_thinking_preference = ( prompt ) => {

    const match = ( prompt || `` ).match( THINKING_DIRECTIVE_RE )
    if( !match ) return null

    const directive = match[ 2 ].toLowerCase().replace( /[\s_-]/g, `` )
    return directive === `nothink` ? false : true

}

const apply_thinking_preference_to_prompt = ( prompt, thinking_enabled ) => {

    if( get_explicit_thinking_preference( prompt ) !== null ) return prompt

    const directive = thinking_enabled ? `/think` : `/no_think`
    const separator = prompt.endsWith( `\n` ) || !prompt ? `` : `\n\n`
    return `${ prompt }${ separator }${ directive }`

}

// ---------------------------------------------------
// Console forwarding — relay worker logs to the main
// process so they can reach the browser DevTools
// ---------------------------------------------------

const _serialise_arg = ( arg ) => {
    if( typeof arg === `object` ) try { return JSON.stringify( arg ) } catch { return String( arg ) }
    return String( arg )
}

for( const level of [ `log`, `info`, `warn`, `error`, `debug` ] ) {

    const original = console[ level ].bind( console )

    console[ level ] = ( ...args ) => {
        original( ...args )
        process.parentPort.postMessage( {
            type: `console-log`,
            payload: { level, message: args.map( _serialise_arg ).join( ` ` ) },
        } )
    }

}

// -------------------------------------------------------
// NativeInference — thin wrapper around node-llama-cpp
// -------------------------------------------------------

class NativeInference {

    constructor() {
        this._llama = null
        this._model = null
        this._context = null
        this._session = null
        this._model_path = null
        this._context_size = null
        this._abort_controller = null
        this._system_prompt = null
        this._LlamaChatSession = null
    }

    /**
     * Load a GGUF model from disk.
     *
     * If the requested context size exceeds available VRAM, we retry with
     * progressively halved context sizes (floor: 512). Failed createContext()
     * calls can fragment VRAM, so if all sizes fail we dispose the model
     * entirely and reload once — a fresh start often succeeds where in-place
     * halving doesn't.
     *
     * @param {string} model_path - Absolute path to the GGUF file
     * @param {Object} [opts] - Loading options
     * @param {number} [opts.n_ctx] - Context window size
     */
    async load( model_path, opts = {} ) {

        if( this._model ) await this.unload()

        // node-llama-cpp loaded lazily — heavy native dep
        const { getLlama, LlamaChatSession } = await import( `node-llama-cpp` )
        this._LlamaChatSession = LlamaChatSession
        this._llama = await getLlama()

        const MIN_CTX = 512
        const requested_ctx = opts.n_ctx || 2048

        // Outer loop: first pass tries halving in-place; second pass
        // reloads the model for clean VRAM and retries at MIN_CTX.
        for( let attempt = 0; attempt < 2; attempt++ ) {

            this._model = await this._llama.loadModel( { modelPath: model_path } )

            let ctx_size = attempt === 0 ? requested_ctx : MIN_CTX

            while( ctx_size >= MIN_CTX ) {

                try {

                    this._context = await this._model.createContext( { contextSize: ctx_size } )
                    this._session = new LlamaChatSession( { contextSequence: this._context.getSequence() } )
                    this._model_path = model_path
                    this._context_size = ctx_size

                    if( ctx_size < requested_ctx ) {
                        console.warn( `[inference] Context reduced: ${ requested_ctx } → ${ ctx_size } (memory limited)` )
                    }

                    return

                } catch ( err ) {

                    const is_vram_error = /vram|memory|too large|alloc/i.test( err.message )

                    // Non-VRAM error — propagate immediately, don't waste time reloading
                    if( !is_vram_error ) {
                        await this._model.dispose()
                        this._model = null
                        throw err
                    }

                    if( ctx_size <= MIN_CTX ) break

                    const next_size = Math.max( MIN_CTX, Math.floor( ctx_size / 2 ) )
                    console.warn( `[inference] Context ${ ctx_size } too large, trying ${ next_size }` )
                    ctx_size = next_size

                }

            }

            // All context sizes failed — dispose for a clean slate
            await this._model.dispose()
            this._model = null

            if( attempt === 0 ) {
                console.warn( `[inference] All context sizes failed — reloading model for clean VRAM` )
            }

        }

        throw new Error( `Not enough memory to load this model (tried context sizes down to ${ MIN_CTX })` )

    }

    /**
     * Ensure the session has the correct system prompt.
     * If the prompt changed since the last call, dispose the old session
     * and create a fresh one so the chat template wraps it correctly.
     */
    _ensure_system_prompt( messages ) {

        const system_msg = messages.find( ( m ) => m.role === `system` )
        const desired = system_msg?.content || ``

        if( desired !== this._system_prompt ) {

            console.info( `[inference] System prompt ${ desired ? `set` : `cleared` } — recreating session` )

            // disposeSequence: true releases the context sequence slot so
            // getSequence() can allocate a fresh one for the new session
            if( this._session ) this._session.dispose( { disposeSequence: true } )

            this._session = new this._LlamaChatSession( {
                contextSequence: this._context.getSequence(),
                ...( desired ? { systemPrompt: desired } : {} ),
            } )
            this._system_prompt = desired

        }

    }

    /**
     * Single-shot chat completion
     * @param {Array} messages - Chat messages
     * @param {Object} [opts] - Generation options
     * @returns {Promise<string>}
     */
    async chat( messages, opts = {} ) {

        if( !this._context ) throw new Error( `No model loaded` )
        this._ensure_system_prompt( messages )

        const last_user_message = [ ...messages ].reverse().find( ( m ) => m.role === `user` )
        const raw_prompt = last_user_message?.content || ``
        const prompt = this._supports_thinking_control()
            ? apply_thinking_preference_to_prompt( raw_prompt, opts.thinking_enabled === true )
            : raw_prompt

        const t0 = performance.now()

        const response = await this._session.prompt( prompt, {
            maxTokens: opts.max_tokens || 2048,
            temperature: opts.temperature || 0.7,
        } )

        const elapsed_s = ( performance.now() - t0 ) / 1000
        const approx_tokens = response.split( /\s+/ ).length
        const desc = this._model_description()
        console.info( `[inference] [${ desc }] Chat complete — ~${ approx_tokens } tokens in ${ elapsed_s.toFixed( 1 ) }s (~${ ( approx_tokens / elapsed_s ).toFixed( 1 ) } tk/s)` )

        return response

    }

    /**
     * Read the actual model identity from the loaded GGUF metadata.
     * Returns a human-readable string like "SmolLM2 1.7B (llama, Q4_K_M)"
     * @returns {string}
     */
    _model_description() {

        try {

            const general = this._model?.fileInfo?.metadata?.general
            const name = general?.name || this._model_path || `unknown`
            const arch = general?.architecture || `?`
            const type_desc = this._model?.typeDescription || ``

            return type_desc ? `${ name } (${ arch }, ${ type_desc })` : `${ name } (${ arch })`

        } catch {
            return this._model_path || `unknown`
        }

    }

    /**
     * Qwen hybrid reasoning models understand /think and /no_think controls.
     * @returns {boolean}
     */
    _supports_thinking_control() {

        const general = this._model?.fileInfo?.metadata?.general || {}
        const haystack = [
            this._model_path,
            general.name,
            general.architecture,
            this._model?.typeDescription,
        ].filter( Boolean ).join( ` ` ).toLowerCase()

        return haystack.includes( `qwen` )

    }

    /**
     * Streaming chat completion — calls on_text for each text chunk
     * @param {Array} messages - Chat messages
     * @param {Object} opts - Generation options
     * @param {Function} on_text - Callback for each text chunk
     */
    async chat_stream( messages, opts, on_text ) {

        if( !this._context ) throw new Error( `No model loaded` )
        this._ensure_system_prompt( messages )
        this._abort_controller = new AbortController()

        const last_user_message = [ ...messages ].reverse().find( ( m ) => m.role === `user` )
        const raw_prompt = last_user_message?.content || ``
        const prompt = this._supports_thinking_control()
            ? apply_thinking_preference_to_prompt( raw_prompt, opts.thinking_enabled === true )
            : raw_prompt

        let token_count = 0
        const t0 = performance.now()
        let ttft = null

        try {

            await this._session.prompt( prompt, {
                maxTokens: opts.max_tokens || 2048,
                temperature: opts.temperature || 0.7,
                signal: this._abort_controller.signal,
                stopOnAbortSignal: true,
                onTextChunk: ( text ) => {
                    token_count++
                    if( ttft === null ) ttft = performance.now() - t0
                    if( on_text ) on_text( text )
                },
            } )

        } catch ( err ) {
            if( err.name !== `AbortError` ) throw err
        } finally {
            this._abort_controller = null
        }

        // Log completion stats with the actual loaded model identity
        const elapsed_ms = performance.now() - t0
        const desc = this._model_description()

        if( token_count > 0 ) {
            const decode_ms = elapsed_ms - ( ttft || 0 )
            const tks = decode_ms > 0 ? ( token_count / ( decode_ms / 1000 ) ).toFixed( 1 ) : `∞`
            console.info( `[inference] [${ desc }] ${ token_count } chunks — ttft ${ ttft.toFixed( 0 ) }ms, ${ tks } tk/s (${ ( elapsed_ms / 1000 ).toFixed( 1 ) }s total)` )
        } else {
            console.warn( `[inference] [${ desc }] Model generated 0 tokens` )
        }

    }

    /** Abort current generation */
    abort() {
        if( this._abort_controller ) {
            this._abort_controller.abort()
            this._abort_controller = null
        }
    }

    /** Unload model and free native resources */
    async unload() {

        if( this._session ) {
            this._session.dispose()
            this._session = null
        }

        if( this._context ) {
            await this._context.dispose()
            this._context = null
        }

        if( this._model ) {
            await this._model.dispose()
            this._model = null
        }

        this._model_path = null
        this._context_size = null
        this._system_prompt = null

    }

    is_loaded() {
        return !!this._model && !!this._context
    }

    get_model_id() {
        return this._model_path
    }

    /**
     * Gather system + GPU info via node-llama-cpp
     * @returns {Promise<Object>}
     */
    async get_system_info() {

        const info = {
            total_memory: os.totalmem(),
            free_memory: os.freemem(),
            cpus: os.cpus().length,
            platform: process.platform,
            arch: process.arch,
            gpu: {
                type: false,
                metal: false,
                cuda: false,
                vulkan: false,
                vram_total: 0,
                vram_free: 0,
                unified_memory: 0,
                device_names: [],
            },
        }

        try {

            const { getLlama } = await import( `node-llama-cpp` )
            const llama = await getLlama()

            const gpu_type = llama.gpu
            if( gpu_type ) info.gpu.type = gpu_type
            info.gpu.metal = gpu_type === `metal`
            info.gpu.cuda = gpu_type === `cuda`
            info.gpu.vulkan = gpu_type === `vulkan`

            const vram = await llama.getVramState()
            info.gpu.vram_total = vram.total || 0
            info.gpu.vram_free = vram.free || 0
            info.gpu.unified_memory = vram.unifiedSize || 0

            info.gpu.device_names = await llama.getGpuDeviceNames()

        } catch {

            // Fallback: Apple Silicon always has Metal
            if( process.platform === `darwin` && process.arch === `arm64` ) {
                info.gpu.type = `metal`
                info.gpu.metal = true
                info.gpu.unified_memory = os.totalmem()
            }

        }

        return info

    }

}

// -------------------------------------------------------
// Message dispatch — handle requests from main process
// -------------------------------------------------------

const provider = new NativeInference()

/** Send a message to the parent (main) process */
const send = ( msg ) => process.parentPort.postMessage( msg )

/** Handle a single request and return the result */
const handle_message = async ( { id, type, payload } ) => {

    try {

        let result

        switch( type ) {

            case `system:info`:
                result = await provider.get_system_info()
                break

            case `load`:
                await provider.load( payload.model_path, payload.opts )
                result = {
                    success: true,
                    context_size: provider._context_size,
                }
                break

            case `chat`:
                result = await provider.chat( payload.messages, payload.opts )
                break

            case `chat_stream`:
                await provider.chat_stream( payload.messages, payload.opts, ( text ) => {
                    send( { type: `stream-token`, payload: text } )
                } )
                send( { type: `stream-done` } )
                result = { success: true }
                break

            case `abort`:
                provider.abort()
                result = { success: true }
                break

            case `unload`:
                await provider.unload()
                result = { success: true }
                break

            case `status`:
                result = {
                    loaded: provider.is_loaded(),
                    model_id: provider.get_model_id(),
                }
                break

            case `shutdown`:
                // Graceful shutdown: cancel generation, free GPU/mmap, then exit
                provider.abort()
                await provider.unload()
                send( { id, type: `response`, payload: { success: true } } )
                process.exit( 0 )
                break

        default:
                throw new Error( `Unknown message type: ${ type }` )

        }

        send( { id, type: `response`, payload: result } )

    } catch ( err ) {
        send( { id, type: `error`, payload: err.message } )
    }

}

process.parentPort.on( `message`, ( { data } ) => handle_message( data ) )

// Safety net — last-chance cancellation if the process is killed without
// the shutdown message (e.g. SIGTERM). `exit` handlers must be synchronous.
process.on( `exit`, () => provider.abort() )
