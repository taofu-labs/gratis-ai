import { log } from 'mentie'

/**
 * Electron IPC-based LLM provider
 * Forwards LLMProvider interface calls over IPC to the main process
 * where node-llama-cpp runs natively
 */
export default class ElectronIPCProvider {

    constructor() {
        this._loaded_model_id = null
        this._loaded_context_length = null
    }

    /**
     * Load a model via IPC
     * @param {string} model_id - The model ID to load
     * @param {Function} [on_progress] - Progress callback
     * @param {{ context_length?: number|null }} [options] - Load options
     * @returns {Promise<void>}
     */
    async load_model( model_id, on_progress, options = {} ) {

        log.debug( `[electron] Loading model ${ model_id }` )
        if( on_progress ) on_progress( { progress: 0, status: `Loading model...` } )

        const result = await window.electronAPI.load_model( model_id, {
            context_length: options.context_length,
        } )
        this._loaded_model_id = model_id
        this._loaded_context_length = options.context_length ?? null

        // Let the caller know if context was reduced due to VRAM limits
        if( result?.context_reduced ) {
            log.warn( `[electron] Context reduced to ${ result.context_size?.toLocaleString() } tokens (VRAM)` )
        }

        const status = result?.context_reduced
            ? `Model ready (context reduced to ${ result.context_size?.toLocaleString() } tokens due to memory limits)`
            : `Model ready`

        log.info( `[electron] Model loaded: ${ model_id }` )
        if( on_progress ) on_progress( { progress: 1, status } )

    }

    /**
     * Single-shot chat completion via IPC
     * @param {Array} messages - Chat messages
     * @param {Object} [opts] - Generation options
     * @returns {Promise<string>}
     */
    async chat( messages, opts = {} ) {
        return window.electronAPI.chat( messages, opts )
    }

    /**
     * Streaming chat completion via IPC
     * Tokens arrive as IPC events from the main process
     * @param {Array} messages - Chat messages
     * @param {Object} [opts] - Generation options
     * @returns {AsyncGenerator<string>}
     */
    async *chat_stream( messages, opts = {} ) {

        log.debug( `[electron] Streaming with ${ messages.length } messages` )

        // Set up token listener before starting stream
        const token_queue = []
        let resolve_next = null
        let stream_done = false

        const token_handler = ( token ) => {
            if( resolve_next ) {
                const r = resolve_next
                resolve_next = null
                r( token )
            } else {
                token_queue.push( token )
            }
        }

        // Listen for stream completion
        const done_handler = () => {
            stream_done = true
            if( resolve_next ) {
                const r = resolve_next
                resolve_next = null
                r( null )
            }
        }

        window.electronAPI.on_stream_token( token_handler )
        window.electronAPI.on_stream_done( done_handler )

        // Fire off the stream — don't await, tokens arrive via IPC events
        const stream_promise = window.electronAPI.start_stream( messages, opts )

        // Yield tokens as they arrive
        try {

            while( !stream_done ) {
                if( token_queue.length > 0 ) {
                    yield token_queue.shift()
                } else {
                    const token = await new Promise( ( r ) => {
                        resolve_next = r
                    } )
                    if( token === null ) break
                    yield token
                }
            }

            // Drain remaining tokens
            while( token_queue.length > 0 ) {
                yield token_queue.shift()
            }

            // Ensure the stream completed without errors
            await stream_promise

        } finally {
            // Clean up listener
            done_handler()
        }

    }

    /**
     * Abort current generation via IPC
     */
    abort() {
        window.electronAPI.abort()
    }

    /**
     * Unload model via IPC
     * @returns {Promise<void>}
     */
    async unload_model() {

        log.debug( `[electron] Unloading model` )
        await window.electronAPI.unload_model()
        this._loaded_model_id = null
        this._loaded_context_length = null

    }

    /**
     * Get the loaded model ID
     * @returns {string|null}
     */
    get_loaded_model() {
        return this._loaded_model_id
    }

    /**
     * Check if a model is loaded
     * @returns {boolean}
     */
    is_ready() {
        return !!this._loaded_model_id
    }

}
