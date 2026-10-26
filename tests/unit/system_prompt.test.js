import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { build_system_prompt } from '../../src/utils/system_prompt'
import { MODEL_CATALOG } from '../../src/utils/model_catalog'

const DATE = new Date( `2026-10-26T12:00:00Z` )
const LOCALES = `src/i18n/locales`
const read_prompt = lang => JSON.parse( readFileSync( `${ LOCALES }/${ lang }/prompt.json`, `utf8` ) )

const plain = MODEL_CATALOG.find( m => !m.uncensored && !m.system_prompt )
const uncensored = MODEL_CATALOG.find( m => m.uncensored && !m.system_prompt )
const persona = MODEL_CATALOG.find( m => m.system_prompt )

describe( `build_system_prompt`, () => {

    test( `base prompt: identity, date, rule bullets`, () => {

        const prompt = build_system_prompt( { model: plain, language: `en`, date: DATE } )

        expect( prompt ).toMatch( /^You are .+, a helpful AI assistant/ )
        expect( prompt ).toContain( `Today is Monday, October 26, 2026.` )
        expect( prompt ).toContain( `- Reply in English. If the user writes in another language, reply in theirs.` )
        expect( prompt ).toContain( `Never invent facts, links, or quotes.` )
        expect( prompt ).not.toContain( read_prompt( `en` ).uncensored )

    } )

    test( `speaks the UI language`, () => {

        const prompt = build_system_prompt( { model: plain, language: `de`, date: DATE } )

        expect( prompt ).toContain( `Antworte auf Deutsch.` )
        expect( prompt ).toContain( `Montag, 26. Oktober 2026` )
        expect( prompt ).not.toContain( `Reply in English` )

    } )

    test( `english-only models keep the English prompt`, () => {

        const english_only = MODEL_CATALOG.find( m => m.english_only )
        const prompt = build_system_prompt( { model: english_only, language: `de`, date: DATE } )

        expect( prompt ).toContain( `- Reply in English.` )
        expect( prompt ).not.toContain( `Deutsch` )

    } )

    test( `uncensored models get the fulfil-any-request line`, () => {

        const prompt = build_system_prompt( { model: uncensored, language: `fr`, date: DATE } )
        expect( prompt ).toContain( `- ${ read_prompt( `fr` ).uncensored }` )

    } )

    test( `catalog persona replaces only the identity line`, () => {

        const prompt = build_system_prompt( { model: persona, language: `en`, date: DATE } )

        expect( prompt.startsWith( persona.system_prompt ) ).toBe( true )
        expect( prompt ).toContain( `- Reply in English.` )
        expect( prompt ).toContain( read_prompt( `en` ).uncensored )

    } )

    test( `custom instructions come last`, () => {

        const prompt = build_system_prompt( { model: plain, language: `en`, custom: `  Talk like a pirate.  `, date: DATE } )
        expect( prompt.endsWith( `User instructions:\nTalk like a pirate.` ) ).toBe( true )

    } )

    test( `every locale ships the same prompt keys as English`, () => {

        const keys = Object.keys( read_prompt( `en` ) ).sort()
        for( const lang of readdirSync( LOCALES ) ) {
            expect( Object.keys( read_prompt( lang ) ).sort(), lang ).toEqual( keys )
        }

    } )

} )
