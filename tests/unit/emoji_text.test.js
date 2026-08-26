import { describe, expect, test } from 'vitest'
import { render_emoji_text } from '../../src/utils/emoji_text'

describe( `emoji text rendering`, () => {

    test( `converts common shortcodes to real emoji`, () => {
        expect( render_emoji_text( `Nice :smile: ship it :rocket:` ) )
            .toBe( `Nice \u{1F604} ship it \u{1F680}` )
    } )

    test( `preserves shortcodes inside code`, () => {
        const content = `Render :sparkles: but keep \`:rocket:\` and \`\`\`txt\n:fire:\n\`\`\``

        expect( render_emoji_text( content ) )
            .toBe( `Render \u2728 but keep \`:rocket:\` and \`\`\`txt\n:fire:\n\`\`\`` )
    } )

} )
