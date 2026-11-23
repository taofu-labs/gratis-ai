import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { storage_key } from '../../src/utils/branding'

const SESSION_KEY = storage_key( `gratis_session` )

// Minimal browser globals: storage, location, fetch
const memory_storage = () => {
    const map = new Map()
    return {
        getItem: key => map.has( key ) ? map.get( key ) : null,
        setItem: ( key, value ) => map.set( key, String( value ) ),
        removeItem: key => map.delete( key ),
    }
}

const json = ( status, body ) => new Response( JSON.stringify( body ), { status, headers: { 'content-type': `application/json` } } )

const sse = chunks => new Response( chunks.map( chunk => `data: ${ JSON.stringify( chunk ) }\n\n` ).join( `` ) + `data: [DONE]\n\n`, { status: 200 } )

let auth, provider_module

beforeEach( async () => {

    vi.resetModules()
    vi.stubEnv( `VITE_GRATIS_CLIENT_ID`, `test-client` )
    vi.stubGlobal( `localStorage`, memory_storage() )
    vi.stubGlobal( `sessionStorage`, memory_storage() )
    const location = { origin: `https://gratis-ai.com`, href: `https://gratis-ai.com/chat`, pathname: `/chat`, search: `` }
    vi.stubGlobal( `location`, location )
    vi.stubGlobal( `window`, { location } )
    vi.stubGlobal( `fetch`, vi.fn() )

    auth = await import( '../../src/utils/gratis_auth' )
    provider_module = await import( '../../src/providers/gratis_provider' )

} )

afterEach( () => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
} )

describe( `Sign in with Gratis`, () => {

    test( `PKCE challenge is base64url( sha256( verifier ) )`, async () => {
        const verifier = `dBjftJeZ4CVP-mJ0kDvGgHhnRMxS1Ylgd7rsYyB6KmU`
        expect( await auth.pkce_challenge( verifier ) ).toBe( createHash( `sha256` ).update( verifier ).digest( `base64url` ) )
    } )

    test( `authorize URL carries client, redirect, scope and S256 challenge`, async () => {
        const url = new URL( await auth.build_authorize_url( `/chat` ) )
        expect( url.origin + url.pathname ).toBe( `https://account.gratis-ai.com/authorize` )
        expect( url.searchParams.get( `client_id` ) ).toBe( `test-client` )
        expect( url.searchParams.get( `redirect_uri` ) ).toBe( `https://gratis-ai.com/pro/callback` )
        expect( url.searchParams.get( `scope` ) ).toBe( `inference offline_access` )
        expect( url.searchParams.get( `code_challenge_method` ) ).toBe( `S256` )
        expect( url.searchParams.get( `state` ) ).toBeTruthy()
    } )

    test( `callback rejects a mismatched state and never calls the token endpoint`, async () => {
        await auth.build_authorize_url( `/chat` )
        await expect( auth.finish_sign_in( new URLSearchParams( `code=abc&state=forged` ) ) ).rejects.toThrow( /expired|another tab/ )
        expect( fetch ).not.toHaveBeenCalled()
    } )

    test( `callback trades the code for a session and returns to the start path`, async () => {
        const state = new URL( await auth.build_authorize_url( `/chat/42` ) ).searchParams.get( `state` )
        fetch.mockResolvedValueOnce( json( 200, { access_token: `at`, refresh_token: `rt`, expires_in: 900 } ) )
        expect( await auth.finish_sign_in( new URLSearchParams( { code: `abc`, state } ) ) ).toBe( `/chat/42` )
        const body = new URLSearchParams( fetch.mock.calls[ 0 ][ 1 ].body )
        expect( body.get( `grant_type` ) ).toBe( `authorization_code` )
        expect( body.get( `code_verifier` ) ).toBeTruthy()
        expect( await auth.get_access_token() ).toBe( `at` )
    } )

    test( `expired token refreshes once for concurrent callers and stores the rotated refresh token`, async () => {
        localStorage.setItem( SESSION_KEY, JSON.stringify( { access_token: `old`, refresh_token: `rt1`, expires_at: 0 } ) )
        fetch.mockResolvedValueOnce( json( 200, { access_token: `new`, refresh_token: `rt2`, expires_in: 900 } ) )
        expect( await Promise.all( [ auth.get_access_token(), auth.get_access_token() ] ) ).toEqual( [ `new`, `new` ] )
        expect( fetch ).toHaveBeenCalledTimes( 1 )
        expect( auth.read_session().refresh_token ).toBe( `rt2` )
    } )

    test( `a rejected refresh signs out and asks to sign in again`, async () => {
        localStorage.setItem( SESSION_KEY, JSON.stringify( { access_token: `old`, refresh_token: `rt1`, expires_at: 0 } ) )
        fetch.mockResolvedValueOnce( json( 400, { error: `invalid_grant` } ) )
        await expect( auth.get_access_token() ).rejects.toThrow( auth.SignInRequiredError )
        expect( auth.is_signed_in() ).toBe( false )
    } )

    test( `a refresh still in flight cannot restore the session after sign-out`, async () => {
        localStorage.setItem( SESSION_KEY, JSON.stringify( { access_token: `old`, refresh_token: `rt1`, expires_at: 0 } ) )
        let answer
        fetch.mockImplementationOnce( () => new Promise( resolve => answer = resolve ) )
        fetch.mockResolvedValue( json( 200, {} ) )
        const pending = auth.get_access_token().catch( err => err )
        await new Promise( resolve => setTimeout( resolve, 0 ) )
        await auth.sign_out()
        answer( json( 200, { access_token: `new`, refresh_token: `rt2`, expires_in: 900 } ) )
        await pending
        expect( auth.is_signed_in() ).toBe( false )
    } )

    test( `a 401 refreshes once and retries before asking to sign in`, async () => {
        localStorage.setItem( SESSION_KEY, JSON.stringify( { access_token: `at1`, refresh_token: `rt1`, expires_at: Date.now() + 600_000 } ) )
        fetch
            .mockResolvedValueOnce( json( 401, { error: { code: `invalid_token` } } ) )
            .mockResolvedValueOnce( json( 200, { access_token: `at2`, refresh_token: `rt2`, expires_in: 900 } ) )
            .mockResolvedValueOnce( json( 200, { percent_used: 1 } ) )
        const response = await auth.gratis_fetch( `/v1/usage` )
        expect( response.status ).toBe( 200 )
        expect( fetch.mock.calls[ 2 ][ 1 ].headers.Authorization ).toBe( `Bearer at2` )
        expect( auth.read_session().refresh_token ).toBe( `rt2` )
    } )

} )

describe( `Gratis Pro provider`, () => {

    const signed_in = () => localStorage.setItem( SESSION_KEY, JSON.stringify( { access_token: `at`, refresh_token: `rt`, expires_at: Date.now() + 600_000 } ) )

    test( `streams text deltas and reports token usage`, async () => {

        signed_in()
        const provider = new provider_module.default()
        fetch.mockResolvedValueOnce( json( 200, { can_infer: true, percent_used: 5 } ) )
        await provider.load_model( `cloud:text-fast` )
        expect( provider.is_ready() ).toBe( true )

        fetch.mockResolvedValueOnce( sse( [
            { choices: [ { delta: { content: `Hel` } } ] },
            { choices: [ { delta: { content: `lo` } } ] },
            { choices: [], usage: { prompt_tokens: 9, completion_tokens: 2 } },
        ] ) )

        const chunks = []
        for await ( const chunk of provider.chat_stream( [ { role: `user`, content: `Hi` } ] ) ) chunks.push( chunk )

        expect( chunks ).toEqual( [ `Hel`, `lo`, { timings: { predicted_n: 2, prompt_n: 9 } } ] )
        const request = JSON.parse( fetch.mock.calls[ 1 ][ 1 ].body )
        expect( request ).toMatchObject( { model: `text-fast`, stream: true, messages: [ { role: `user`, content: `Hi` } ] } )
        expect( fetch.mock.calls[ 1 ][ 1 ].headers.Authorization ).toBe( `Bearer at` )

    } )

    test( `an error event mid-stream rejects instead of passing as a finished reply`, async () => {
        signed_in()
        const provider = new provider_module.default()
        fetch.mockResolvedValueOnce( json( 200, { can_infer: true } ) )
        await provider.load_model( `cloud:text-fast` )
        fetch.mockResolvedValueOnce( sse( [ { choices: [ { delta: { content: `Par` } } ] }, { error: { code: `upstream_error`, message: `boom` } } ] ) )
        const read = async () => {
            for await ( const chunk of provider.chat_stream( [ { role: `user`, content: `Hi` } ] ) ) void chunk
        }
        await expect( read() ).rejects.toThrow()
    } )

    test( `loading without a plan fails with a plain explanation`, async () => {
        signed_in()
        fetch.mockResolvedValueOnce( json( 403, { error: { code: `no_tier`, message: `no tier` } } ) )
        await expect( new provider_module.default().load_model( `cloud:text-fast` ) ).rejects.toMatchObject( { code: `no_tier` } )
    } )

    test( `loading while signed out asks to sign in`, async () => {
        await expect( new provider_module.default().load_model( `cloud:text-smart` ) ).rejects.toThrow( auth.SignInRequiredError )
    } )

    test( `used-up allowance maps to its own error`, () => {
        expect( provider_module.gratis_error( 429, { error: { code: `usage_limit_reached` } } ).code ).toBe( `usage_limit_reached` )
    } )

    test( `cloud ids are recognised; local ids are not`, () => {
        expect( provider_module.is_cloud_model( `cloud:text-fast` ) ).toBe( true )
        expect( provider_module.is_cloud_model( `smollm2-360m` ) ).toBe( false )
        expect( provider_module.is_cloud_model( null ) ).toBe( false )
    } )

} )
