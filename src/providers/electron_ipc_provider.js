import { log } from 'mentie'
import { MAX_HISTORY_IMAGES, limit_images } from '../utils/attachments'
import { get_model_by_id, has_image_input } from '../utils/model_catalog'

/**
 * Prepare renderer messages for IPC. Image Blobs cannot cross the context
 * bridge, so they become ArrayBuffers (main turns them into data URIs for
 * the vision sidecar). Same image cap as the browser (`limit_images`); without
 * image input every image becomes a note.
 * @param {Array} messages
 * @param {boolean} with_images
 * @returns {Promise<Array>}
 */
export const to_ipc_messages = ( messages, with_images ) => Promise.all( limit_images( messages, with_images ? MAX_HISTORY_IMAGES : 0 ).map( async ( { attachments, ...message } ) => {

    const images = ( attachments || [] ).filter( ( { kind, data } ) => kind === `image` && data )
    if( !images.length ) return message

    return {
        ...message,
        attachments: await Promise.all( images.map( async ( { data, ...image } ) => ( {
            ...image,
            data: data instanceof Blob ? await data.arrayBuffer() : data,
        } ) ) ),
    }

} ) )

/**
 * Electron IPC-based LLM provider
 * Forwards LLMProvider interface calls over IPC to the main process
 * where node-llama-cpp runs natively
 */
export default class ElectronIPCProvider {

    constructor() {
        this._loaded_model_id = null
        this._has_image_input = false
        this._capabilities = { image_blocked: null, context_size: 0 }
    }

    /**
     * Load a model via IPC
     * @param {string} model_id - The model ID to load
     * @param {Function} [on_progress] - Progress callback
     * @returns {Promise<void>}
     */
    async load_model( model_id, on_progress ) {

        log.debug( `[electron] Loading model ${ model_id }` )
        if( on_progress ) on_progress( { progress: 0, status: `Loading model...` } )

        const result = await window.electronAPI.load_model( model_id )
        this._loaded_model_id = model_id

        // Vision models run in the llama-server sidecar when their projector is installed
        this._has_image_input = !!result?.has_image_input

        // A catalog vision model installed before its projector existed: offer the download
        const projector_missing = !this._has_image_input && result?.has_projector === false && has_image_input( get_model_by_id( model_id ) )
        this._capabilities = { image_blocked: projector_missing ? `projector_missing` : null, context_size: result?.context_size || 0 }

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
        return window.electronAPI.chat( await to_ipc_messages( messages, this._has_image_input ), opts )
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

        const remove_token_listener = window.electronAPI.on_stream_token( token_handler )
        const remove_done_listener = window.electronAPI.on_stream_done( done_handler )

        // Fire off the stream — don't await, tokens arrive via IPC events.
        // Chunks are text, or `{ prompt_progress }` / `{ timings }` from the sidecar.
        const ipc_messages = await to_ipc_messages( messages, this._has_image_input )
        const stream_promise = window.electronAPI.start_stream( ipc_messages, opts )

        // A failed stream may never send stream-done — unblock the loop so the error surfaces below
        stream_promise.catch( () => done_handler() )

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
            // Release this stream's listeners so later streams do not pile them up
            done_handler()
            remove_token_listener?.()
            remove_done_listener?.()
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
        this._has_image_input = false
        this._capabilities = { image_blocked: null, context_size: 0 }

    }

    /**
     * Get the loaded model ID
     * @returns {string|null}
     */
    get_loaded_model() {
        return this._loaded_model_id
    }

    /**
     * What the loaded model can read; same shape as the wllama provider
     * @returns {{ image_input: boolean, image_blocked: string|null, context_size: number }}
     */
    get_capabilities() {
        return { ...this._capabilities, image_input: this._has_image_input }
    }

    /**
     * Whether the loaded model accepts image attachments
     * @returns {boolean}
     */
    has_image_input() {
        return this._has_image_input
    }

    /**
     * Check if a model is loaded
     * @returns {boolean}
     */
    is_ready() {
        return !!this._loaded_model_id
    }

}
