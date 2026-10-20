/**
 * Format generation stats into a display string.
 * Accepts an optional `t` function for i18n; falls back to a plain English template.
 * Stopped and interrupted replies lead with that state; an empty one shows only it.
 * @param {import('../providers/types').GenerationStats} stats
 * @param {Function} [t] - i18next translation function
 * @returns {string} e.g., "42 tokens · 8.3 tok/s · 5.1s · 1.2s to first token"
 */
export const format_stats = ( stats, t ) => {

    if( !stats ) return ``

    const translate = ( key, fallback, values ) => t ? t( `common:${ key }`, values ) : fallback

    const state = stats.interrupted ? translate( `format_interrupted`, `Interrupted` )
        : stats.stopped ? translate( `format_stopped`, `Stopped` )
            : null

    // Nothing measurable: a stop during prefill, or a reply cut off by a closed tab
    if( !stats.tokens_generated && state ) return state

    const tokens = stats.tokens_generated || 0
    const tps = ( stats.tokens_per_second || 0 ).toFixed( 1 )
    const time = ( ( stats.elapsed_ms || 0 ) / 1000 ).toFixed( 1 )
    const ttft = ( ( stats.ttft_ms || 0 ) / 1000 ).toFixed( 1 )

    const parts = [
        state,
        translate( `format_tokens`, `${ tokens } tokens · ${ tps } tok/s · ${ time }s`, { tokens, tps, time } ),
        stats.ttft_ms ? translate( `format_ttft`, `${ ttft }s to first token`, { ttft } ) : null,
    ]

    return parts.filter( Boolean ).join( ` · ` )

}

/**
 * Truncate text to max length with ellipsis
 * @param {string} text
 * @param {number} max_length
 * @returns {string}
 */
export const truncate = ( text, max_length = 50 ) => {
    if( !text || text.length <= max_length ) return text || ``
    return `${ text.slice( 0, max_length ) }...`
}

/**
 * Format a timestamp into a relative or short date string.
 * Accepts an optional `t` function for i18n; falls back to plain English.
 * @param {number} timestamp
 * @param {Function} [t] - i18next translation function
 * @returns {string}
 */
export const format_time = ( timestamp, t ) => {

    const now = Date.now()
    const diff = now - timestamp

    if( t ) {
        if( diff < 60_000 ) return t( `common:format_just_now` )
        if( diff < 3_600_000 ) return t( `common:format_minutes_ago`, { count: Math.floor( diff / 60_000 ) } )
        if( diff < 86_400_000 ) return t( `common:format_hours_ago`, { count: Math.floor( diff / 3_600_000 ) } )
    } else {
        if( diff < 60_000 ) return `Just now`
        if( diff < 3_600_000 ) return `${ Math.floor( diff / 60_000 ) }m ago`
        if( diff < 86_400_000 ) return `${ Math.floor( diff / 3_600_000 ) }h ago`
    }

    return new Date( timestamp ).toLocaleDateString()

}
