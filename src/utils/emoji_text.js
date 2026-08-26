const EMOJI_SHORTCODES = {
    '100': `\u{1F4AF}`,
    angry: `\u{1F620}`,
    blush: `\u{1F60A}`,
    broken_heart: `\u{1F494}`,
    check: `\u2705`,
    clap: `\u{1F44F}`,
    cry: `\u{1F622}`,
    eyes: `\u{1F440}`,
    fire: `\u{1F525}`,
    grin: `\u{1F604}`,
    grinning: `\u{1F600}`,
    heart: `\u2764\uFE0F`,
    joy: `\u{1F602}`,
    mind_blown: `\u{1F92F}`,
    ok_hand: `\u{1F44C}`,
    party: `\u{1F973}`,
    pray: `\u{1F64F}`,
    red_heart: `\u2764\uFE0F`,
    rocket: `\u{1F680}`,
    rofl: `\u{1F923}`,
    sad: `\u{1F61E}`,
    skull: `\u{1F480}`,
    smile: `\u{1F604}`,
    sob: `\u{1F62D}`,
    sparkles: `\u2728`,
    star: `\u2B50`,
    sunglasses: `\u{1F60E}`,
    tada: `\u{1F389}`,
    thinking: `\u{1F914}`,
    thumbsup: `\u{1F44D}`,
    thumbs_up: `\u{1F44D}`,
    thumbsdown: `\u{1F44E}`,
    thumbs_down: `\u{1F44E}`,
    warning: `\u26A0\uFE0F`,
    wave: `\u{1F44B}`,
    wink: `\u{1F609}`,
    x: `\u274C`,
}

const CODE_SPAN_OR_BLOCK = /(```[\s\S]*?```|`[^`\n]+`)/g
const SHORTCODE = /(^|[^\w`]):([a-z0-9_+-]+):(?=$|[^\w`])/gi

const normalize_shortcode = value => value.toLowerCase().replace( /-/g, `_` )

const convert_shortcodes = text =>
    text.replace( SHORTCODE, ( match, prefix, name ) => {
        const emoji = EMOJI_SHORTCODES[ normalize_shortcode( name ) ]
        return emoji ? `${ prefix }${ emoji }` : match
    } )

/**
 * Convert common chat-style emoji shortcodes to Unicode emoji while preserving code.
 * @param {string} text
 * @returns {string}
 */
export const render_emoji_text = text => {

    if( !text ) return text

    return String( text )
        .split( CODE_SPAN_OR_BLOCK )
        .map( part => part.startsWith( '`' ) ? part : convert_shortcodes( part ) )
        .join( `` )

}
