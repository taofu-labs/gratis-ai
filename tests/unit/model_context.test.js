import { describe, expect, test } from 'vitest'
import {
    DEFAULT_RUNTIME_CONTEXT,
    MAX_BROWSER_CONTEXT,
    select_browser_context,
} from '../../src/utils/model_catalog'

const MODEL = {
    file_size_bytes: 1_000_000_000,
    context_length: 131_072,
    layers: 32,
    kv_heads: 8,
    head_dim: 128,
}

describe( `browser context selection`, () => {

    test( `keeps the safe baseline when the next context exceeds budget`, () => {
        expect( select_browser_context( MODEL, 1_900_000_000 ) ).toBe( DEFAULT_RUNTIME_CONTEXT )
    } )

    test( `grows by powers of two without exceeding the browser cap`, () => {
        expect( select_browser_context( MODEL, 4_000_000_000 ) ).toBe( MAX_BROWSER_CONTEXT )
    } )

    test( `respects a model context below the browser cap`, () => {
        const short_model = { ...MODEL, context_length: 8192 }
        expect( select_browser_context( short_model, 4_000_000_000 ) ).toBe( 8192 )
    } )

    test( `keeps custom models at the baseline without architecture metadata`, () => {
        const custom_model = { file_size_bytes: 500_000_000, context_length: 32_768 }
        expect( select_browser_context( custom_model, 4_000_000_000 ) ).toBe( DEFAULT_RUNTIME_CONTEXT )
    } )

} )
