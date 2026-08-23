const THINKING_DIRECTIVE_RE = /(^|\s)\/(no[\s_-]?think|think)(?=$|\s|[.!?,;:])/i

const find_last_user_message_index = ( messages ) => {

    for( let i = messages.length - 1; i >= 0; i-- ) {
        if( messages[ i ]?.role === `user` ) return i
    }

    return -1

}

/**
 * Read the latest explicit /think or /no_think directive from the newest user turn.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {boolean|null}
 */
export const get_explicit_thinking_preference = ( messages ) => {

    if( !Array.isArray( messages ) ) return null

    const index = find_last_user_message_index( messages )
    if( index === -1 ) return null

    const content = messages[ index ]?.content || ``
    const match = content.match( THINKING_DIRECTIVE_RE )
    if( !match ) return null

    const directive = match[ 2 ].toLowerCase().replace( /[\s_-]/g, `` )
    return directive === `nothink` ? false : true

}

/**
 * Add a Qwen thinking directive to the newest user turn without mutating history.
 * Explicit user-provided /think or /no_think always wins.
 * @param {Array<{role: string, content: string}>} messages
 * @param {boolean} thinking_enabled
 * @returns {Array<{role: string, content: string}>}
 */
export const apply_thinking_preference_to_messages = ( messages, thinking_enabled ) => {

    if( !Array.isArray( messages ) ) return messages
    if( get_explicit_thinking_preference( messages ) !== null ) return messages

    const index = find_last_user_message_index( messages )
    if( index === -1 ) return messages

    const directive = thinking_enabled ? `/think` : `/no_think`

    return messages.map( ( message, i ) => {

        if( i !== index ) return message

        const content = message.content || ``
        const separator = content.endsWith( `\n` ) || !content ? `` : `\n\n`
        return { ...message, content: `${ content }${ separator }${ directive }` }

    } )

}

/**
 * Build chat-template kwargs for runtimes that support Qwen's enable_thinking flag.
 * @param {Array<{role: string, content: string}>} messages
 * @param {boolean} thinking_enabled
 * @returns {{enable_thinking: boolean}}
 */
export const get_thinking_chat_template_kwargs = ( messages, thinking_enabled ) => {

    const explicit = get_explicit_thinking_preference( messages )
    return { enable_thinking: explicit ?? thinking_enabled === true }

}

/**
 * Qwen hybrid reasoning models are the known family that understands these controls.
 * @param {Record<string, unknown>} identity
 * @returns {boolean}
 */
export const supports_thinking_control = ( identity = {} ) => {

    const haystack = Object.values( identity )
        .filter( value => typeof value === `string` )
        .join( ` ` )
        .toLowerCase()

    return haystack.includes( `qwen` )

}
