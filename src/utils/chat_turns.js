/**
 * The exact message list a reply is generated from. Replies and prompt
 * warm-ups both build it here: llama.cpp only reuses its cache for a
 * byte-identical prefix, so any drift between the two wastes the warm-up.
 */

// A leading reasoning block; an unclosed one runs to the end of the reply
const THINK_BLOCK = /^\s*<think>[\s\S]*?(?:<\/think>\s*|$)/

/**
 * Drop the reasoning from an earlier reply. Chat templates discard it from
 * history anyway (Qwen3, DeepSeek R1); doing it here keeps every template
 * consistent and the prompt short.
 * @param {string} content
 * @returns {string}
 */
export const strip_thinking = ( content = `` ) => content.replace( THINK_BLOCK, `` )

/**
 * Conversation history as the model reads it.
 *
 * Empty turns (a stop before the first token) carry nothing and are dropped;
 * strict templates (Gemma, Mistral) demand alternating roles, so the turns
 * that end up adjacent are merged.
 *
 * @param {Object} params
 * @param {Array} params.messages - Stored chat messages, oldest first
 * @param {string} [params.system_prompt]
 * @param {string} [params.draft] - Unsent user text, sent as the next user turn; kept even when empty, so a warm-up reads up to it
 * @returns {Array<{ role: string, content: string, attachments?: Array }>}
 */
export const build_turns = ( { messages, system_prompt = ``, draft } ) => {

    // The draft goes through the same merging the sent message will
    const pending = draft === undefined ? messages : [ ...messages, { role: `user`, content: draft, is_draft: true } ]

    const turns = pending
        .map( message => message.role === `assistant` ? { ...message, content: strip_thinking( message.content ) } : message )
        .filter( ( { content, attachments, is_draft } ) => content || attachments?.length || is_draft )
        .reduce( ( merged, { role, content, attachments } ) => {

            const images = attachments?.filter( ( { kind } ) => kind === `image` ) || []
            const previous = merged.at( -1 )

            if( previous?.role === role ) {
                previous.content = [ previous.content, content ].filter( Boolean ).join( `\n\n` )
                previous.attachments = [ ...previous.attachments || [], ...images ]
            } else merged.push( { role, content, ... images.length ? { attachments: images } : {} } )

            return merged

        }, [] )

    if( system_prompt ) turns.unshift( { role: `system`, content: system_prompt } )

    return turns

}
