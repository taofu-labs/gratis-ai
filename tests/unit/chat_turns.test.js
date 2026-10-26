import { describe, expect, test } from 'vitest'
import { build_turns, strip_thinking, system_prompt_for } from '../../src/utils/chat_turns.js'

const user = content => ( { role: `user`, content } )
const assistant = content => ( { role: `assistant`, content } )

describe( `strip_thinking`, () => {

    test( `drops a leading reasoning block`, () => {
        expect( strip_thinking( `<think>\nhmm\n</think>\n\nPacific` ) ).toBe( `Pacific` )
    } )

    test( `an unclosed block was all reasoning`, () => {
        expect( strip_thinking( `<think>still going` ) ).toBe( `` )
    } )

    test( `leaves plain replies and later tags alone`, () => {
        expect( strip_thinking( `Plain` ) ).toBe( `Plain` )
        expect( strip_thinking( `Use <think> tags` ) ).toBe( `Use <think> tags` )
    } )

} )

describe( `build_turns`, () => {

    test( `prepends the system prompt and strips earlier reasoning`, () => {
        const turns = build_turns( {
            messages: [ user( `Hi` ), assistant( `<think>x</think>Hello` ), user( `Again` ) ],
            system_prompt: `Be brief`,
        } )
        expect( turns ).toEqual( [
            { role: `system`, content: `Be brief` },
            user( `Hi` ),
            assistant( `Hello` ),
            user( `Again` ),
        ] )
    } )

    test( `drops empty replies and merges the turns left adjacent`, () => {
        const turns = build_turns( { messages: [ user( `One` ), assistant( `` ), user( `Two` ) ] } )
        expect( turns ).toEqual( [ { role: `user`, content: `One\n\nTwo`, attachments: [] } ] )
    } )

    test( `keeps image attachments only`, () => {
        const image = { kind: `image`, data: `x` }
        const turns = build_turns( { messages: [ { role: `user`, content: `See`, attachments: [ image, { kind: `document` } ] } ] } )
        expect( turns ).toEqual( [ { role: `user`, content: `See`, attachments: [ image ] } ] )
    } )

    test( `appends the draft as the next user turn, even empty`, () => {
        const messages = [ user( `Hi` ), assistant( `Hello` ) ]
        expect( build_turns( { messages, draft: `Next` } ).at( -1 ) ).toEqual( user( `Next` ) )
        expect( build_turns( { messages, draft: `` } ).at( -1 ) ).toEqual( user( `` ) )
        expect( build_turns( { messages: [], system_prompt: `S`, draft: `` } ) ).toEqual( [ { role: `system`, content: `S` }, user( `` ) ] )
    } )

    test( `a draft after a dropped empty reply merges like the sent message will`, () => {
        const messages = [ user( `First` ), assistant( `` ) ]
        const warm = build_turns( { messages, draft: `Second` } )
        expect( warm ).toEqual( build_turns( { messages: [ ...messages, user( `Second` ) ] } ) )
        expect( warm ).toEqual( [ { role: `user`, content: `First\n\nSecond`, attachments: [] } ] )
    } )

    test( `the warm-up prefix matches the real request`, () => {
        const messages = [ user( `Hi` ), assistant( `<think>a</think>Hello` ) ]
        const warm = build_turns( { messages, system_prompt: `S`, draft: `Next question` } )
        const real = build_turns( { messages: [ ...messages, user( `Next question` ) ], system_prompt: `S` } )
        expect( warm ).toEqual( real )
    } )

} )

test( `system_prompt_for prefers the model persona`, () => {
    expect( system_prompt_for( { system_prompt: `Persona` }, `User` ) ).toBe( `Persona` )
    expect( system_prompt_for( null, `User` ) ).toBe( `User` )
    expect( system_prompt_for( null ) ).toBe( `` )
} )
