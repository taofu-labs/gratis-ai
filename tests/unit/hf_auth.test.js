import { describe, expect, test } from 'vitest'
import {
    get_hf_headers,
    normalize_hf_error,
    sanitize_hf_token,
    with_hf_headers,
} from '../../src/utils/hf_auth'

describe( `Hugging Face auth helpers`, () => {

    test( `trims tokens and builds bearer headers`, () => {
        expect( sanitize_hf_token( `  hf_test  ` ) ).toBe( `hf_test` )
        expect( get_hf_headers( `  hf_test  ` ) ).toEqual( {
            Authorization: `Bearer hf_test`,
        } )
    } )

    test( `omits headers when no token is set`, () => {
        expect( get_hf_headers( `` ) ).toEqual( {} )
        expect( with_hf_headers( { method: `HEAD` }, {} ) ).toEqual( { method: `HEAD` } )
    } )

    test( `merges auth without overwriting explicit request headers`, () => {
        expect( with_hf_headers(
            { headers: { Range: `bytes=0-99` } },
            { Authorization: `Bearer hf_test` },
        ) ).toEqual( {
            headers: {
                Authorization: `Bearer hf_test`,
                Range: `bytes=0-99`,
            },
        } )
    } )

    test( `normalizes rate-limit download errors`, () => {
        const error = normalize_hf_error( new Error( `Download failed: 429 Too Many Requests` ) )
        expect( error.message ).toContain( `throttling` )
        expect( error.status ).toBe( 429 )
    } )

    test( `normalizes SDK statusCode errors`, () => {
        const error = normalize_hf_error( { statusCode: 404 } )
        expect( error.message ).toContain( `could not find` )
        expect( error.status ).toBe( 404 )
    } )

} )
