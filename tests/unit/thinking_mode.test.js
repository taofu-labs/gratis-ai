import { describe, expect, it } from 'vitest'
import {
    apply_thinking_preference_to_messages,
    get_explicit_thinking_preference,
    get_thinking_chat_template_kwargs,
    supports_thinking_control,
} from '../../src/utils/thinking_mode'

describe( `thinking mode helpers`, () => {

    it( `adds /no_think to the latest user message when disabled`, () => {

        const messages = [
            { role: `system`, content: `Be brief.` },
            { role: `user`, content: `yo` },
        ]

        const result = apply_thinking_preference_to_messages( messages, false )

        expect( result[ 1 ].content ).toBe( `yo\n\n/no_think` )
        expect( messages[ 1 ].content ).toBe( `yo` )

    } )

    it( `adds /think to the latest user message when enabled`, () => {

        const result = apply_thinking_preference_to_messages( [
            { role: `user`, content: `solve this carefully` },
        ], true )

        expect( result[ 0 ].content ).toBe( `solve this carefully\n\n/think` )

    } )

    it( `lets an explicit /think override a disabled setting`, () => {

        const messages = [
            { role: `user`, content: `solve this /think` },
        ]

        expect( get_explicit_thinking_preference( messages ) ).toBe( true )
        expect( apply_thinking_preference_to_messages( messages, false ) ).toBe( messages )
        expect( get_thinking_chat_template_kwargs( messages, false ) ).toEqual( { enable_thinking: true } )

    } )

    it( `lets an explicit /no_think override an enabled setting`, () => {

        const messages = [
            { role: `user`, content: `quick answer please /no_think` },
        ]

        expect( get_explicit_thinking_preference( messages ) ).toBe( false )
        expect( apply_thinking_preference_to_messages( messages, true ) ).toBe( messages )
        expect( get_thinking_chat_template_kwargs( messages, true ) ).toEqual( { enable_thinking: false } )

    } )

    it( `detects Qwen models as thinking-control compatible`, () => {

        expect( supports_thinking_control( {
            model_id: `hf:unsloth/Qwen3.5-4B-GGUF:Q3_K_S`,
            architecture: `qwen3`,
        } ) ).toBe( true )

        expect( supports_thinking_control( {
            model_id: `hf:bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M`,
            architecture: `llama`,
        } ) ).toBe( false )

    } )

} )
