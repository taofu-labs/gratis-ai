import { log } from 'mentie'
import i18n from '../i18n'
import { gratis_fetch, SignInRequiredError } from '../utils/gratis_auth'
import { create_sse_parser } from '../utils/llama_server_protocol'

/**
 * Gratis Pro cloud models. Ids carry a `cloud:` prefix so the store can tell
 * them from local GGUFs; the suffix is the Gratis alias (admins repoint aliases
 * server-side, so the app never pins raw model ids).
 */
export const CLOUD_PREFIX = `cloud:`

export const CLOUD_MODELS = [
    { id: `cloud:text-fast`, alias: `text-fast`, name_key: `pro:model_fast`, hint_key: `pro:model_fast_hint` },
    { id: `cloud:text-smart`, alias: `text-smart`, name_key: `pro:model_smart`, hint_key: `pro:model_smart_hint` },
]

export const is_cloud_model = ( id = `` ) => !!id?.startsWith( CLOUD_PREFIX )

export const get_cloud_model = id => CLOUD_MODELS.find( model => model.id === id )

// Cloud models read long prompts; this only sizes the app's own history trimming
const CLOUD_CONTEXT_SIZE = 32_768

/**
 * Turn a Gratis error body into something a person can act on
 * @param {number} status
 * @param {{ error?: { code?: string, message?: string } }} body
 * @returns {Error}
 */
export const gratis_error = ( status, body = {} ) => {

    const code = body?.error?.code || ``
    const known = {
        no_tier: `pro:error_no_plan`,
        model_not_in_tier: `pro:error_not_in_plan`,
        usage_limit_reached: `pro:error_allowance_used`,
        too_many_concurrent_requests: `pro:error_busy`,
        free_capacity_exhausted: `pro:error_capacity`,
        capacity_exhausted: `pro:error_capacity`,
    }

    const key = known[ code ] || ( status >= 500 ? `pro:error_capacity` : null )
    const error = new Error( key ? i18n.t( key ) : body?.error?.message || `Gratis Pro request failed (${ status })` )
    error.code = code
    error.status = status
    return error

}

/**
 * Flatten a turn for the API. Cloud models get text only for now; the store
 * reports `image_input: false`, so the chat never offers image attachments.
 */
const to_api_message = ( { role, content } ) => ( { role, content: typeof content === `string` ? content : `` } )

/**
 * OpenAI-compatible streaming provider for Gratis Pro. Same interface as the
 * local providers (see ./types.js): "loading" a model only checks access.
 */
export default class GratisProvider {

    constructor() {
        this._model = null
        this._controller = null
    }

    async load_model( model_id, on_progress ) {

        const model = get_cloud_model( model_id )
        if( !model ) throw new Error( `Unknown Pro model: ${ model_id }` )

        on_progress?.( { progress: 0, status: `Checking Gratis Pro access` } )

        // Fails fast on a missing session, plan or allowance before the first message
        const response = await gratis_fetch( `/v1/usage` )
        const usage = await response.json().catch( () => ( {} ) )
        if( !response.ok ) throw gratis_error( response.status, usage )
        if( usage.can_infer === false ) {
            const blocker = usage.blockers?.[ 0 ]
            throw gratis_error( 403, { error: { code: blocker?.code || blocker || `no_tier` } } )
        }

        this._model = model
        on_progress?.( { progress: 1, status: `Ready` } )
        log.info( `[gratis] Using ${ model.alias }` )

    }

    async *chat_stream( messages, opts = {} ) {

        if( !this._model ) throw new SignInRequiredError()

        this._controller?.abort()
        const controller = new AbortController()
        this._controller = controller

        const response = await gratis_fetch( `/v1/chat/completions`, {
            method: `POST`,
            signal: controller.signal,
            headers: { 'Content-Type': `application/json` },
            body: JSON.stringify( {
                model: this._model.alias,
                messages: messages.map( to_api_message ),
                stream: true,
                ... opts.temperature !== undefined ? { temperature: opts.temperature } : {},
                ... opts.top_p !== undefined ? { top_p: opts.top_p } : {},
                ... opts.max_tokens ? { max_tokens: opts.max_tokens } : {},
            } ),
        } )

        if( !response.ok ) throw gratis_error( response.status, await response.json().catch( () => ( {} ) ) )

        // SSE → text deltas; the last chunk's `usage` becomes the store's timings
        const queue = []
        const parse = create_sse_parser( data => {
            const text = data.choices?.[ 0 ]?.delta?.content
            if( text ) queue.push( text )
            if( data.usage?.completion_tokens ) queue.push( { timings: { predicted_n: data.usage.completion_tokens, prompt_n: data.usage.prompt_tokens } } )
        } )

        const reader = response.body.getReader()
        const decoder = new TextDecoder()

        try {
            while( true ) {
                const { done, value } = await reader.read()
                if( done ) break
                parse( decoder.decode( value, { stream: true } ) )
                while( queue.length ) yield queue.shift()
            }
        } finally {
            reader.releaseLock?.()
            if( this._controller === controller ) this._controller = null
        }

    }

    async chat( messages, opts ) {
        let text = ``
        for await ( const chunk of this.chat_stream( messages, opts ) ) if( typeof chunk === `string` ) text += chunk
        return text
    }

    // fetch() rejects with an AbortError, which the store treats as a user stop
    abort() {
        this._controller?.abort()
    }

    async unload_model() {
        this.abort()
        this._model = null
    }

    get_loaded_model() {
        return this._model?.id || null
    }

    is_ready() {
        return !!this._model
    }

    get_capabilities() {
        return { image_input: false, image_blocked: null, context_size: CLOUD_CONTEXT_SIZE }
    }

    has_image_input() {
        return false
    }

}
