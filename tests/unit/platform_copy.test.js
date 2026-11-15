import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const read = path => readFileSync( new URL( `../../${ path }`, import.meta.url ), `utf8` )
const locales = readdirSync( new URL( `../../src/i18n/locales`, import.meta.url ) )
const locale = ( language, namespace ) => JSON.parse( read( `src/i18n/locales/${ language }/${ namespace }.json` ) )

describe( `Mac minimum OS`, () => {

    // llama-server links Accelerate's NEWLAPACK ILP64 symbols, new in macOS 13.3
    test( `the build declares macOS 13.3, for the DMG and (inherited) the App Store build`, () => {

        const config = read( `electron-builder.yml` )
        const [ , mac_section ] = config.match( /\nmac:\n([\s\S]*?)\n\S/ )
        const [ , mas_section ] = config.match( /\nmas:\n([\s\S]*?)\n\S/ )

        expect( mac_section ).toMatch( /^ {2}minimumSystemVersion: "13\.3"$/m )
        expect( mas_section ).not.toMatch( /minimumSystemVersion/ )

    } )

    test( `every place that states the requirement says 13.3`, () => {

        const statements = [ read( `README.md` ).match( /macOS 13[^;)]*/ )[ 0 ], ...locales.map( language => locale( language, `pages` ).mac_requirement ) ]

        expect( statements ).toHaveLength( locales.length + 1 )
        statements.forEach( statement => expect( statement ).toMatch( /macOS 13\.3/ ) )

    } )

} )

describe( `two-step confirmation wording`, () => {

    test( `fits touch and pointer alike in every language`, () => {

        const labels = locales.map( language => locale( language, `settings` ).press_again_to_confirm )

        expect( labels.every( Boolean ) ).toBe( true )
        expect( locale( `en`, `settings` ).press_again_to_confirm ).toBe( `Press again to confirm` )

        // The pointer-only verbs this replaced
        labels.forEach( label => expect( label ).not.toMatch( /click|clic|klik|クリック|点击/i ) )

    } )

} )
