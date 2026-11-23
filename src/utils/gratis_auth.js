import { log } from 'mentie'
import { storage_key } from './branding'

/**
 * "Sign in with Gratis": OAuth 2.1 authorization code + PKCE (public client).
 * Docs: https://account.gratis-ai.com/llms.txt
 *
 * - Access tokens live 15 min; refresh tokens rotate on every use
 * - The session lives in localStorage; the PKCE verifier in sessionStorage
 * - Pro is web-only for now: native shells fail the API's origin check
 */

export const GRATIS_BASE_URL = import.meta.env.VITE_GRATIS_BASE_URL || `https://account.gratis-ai.com`
export const GRATIS_CLIENT_ID = import.meta.env.VITE_GRATIS_CLIENT_ID || ``
export const CALLBACK_PATH = `/pro/callback`

const SCOPE = `inference offline_access`
const SESSION_KEY = storage_key( `gratis_session` )
const PENDING_KEY = storage_key( `gratis_pending_auth` )

// Refresh a little early so a token never expires mid-request
const EXPIRY_MARGIN_MS = 30_000

/** Thrown when the user must sign in (again) before cloud inference works */
export class SignInRequiredError extends Error {
    constructor( message = `Sign in with Gratis to use Pro models.` ) {
        super( message )
        this.name = `SignInRequiredError`
    }
}

/**
 * Pro needs a client id and a plain web origin (Electron and the mobile shells set `electronAPI`)
 * @returns {boolean}
 */
export const pro_available = () => !!GRATIS_CLIENT_ID && typeof window !== `undefined` && !window.electronAPI

export const redirect_uri = () => `${ window.location.origin }${ CALLBACK_PATH }`

// ── Session storage ──────────────────────────────────────────────

/** @returns {{ access_token: string, refresh_token?: string, expires_at: number } | null} */
export const read_session = () => {
    try {
        return JSON.parse( localStorage.getItem( SESSION_KEY ) ) || null
    } catch {
        return null
    }
}

const write_session = ( { access_token, refresh_token, expires_in } ) => {
    const session = { access_token, refresh_token, expires_at: Date.now() + expires_in * 1000 }
    localStorage.setItem( SESSION_KEY, JSON.stringify( session ) )
    return session
}

export const clear_session = () => localStorage.removeItem( SESSION_KEY )

export const is_signed_in = () => !!read_session()

// ── PKCE helpers ─────────────────────────────────────────────────

const base64url = bytes => btoa( String.fromCharCode( ...new Uint8Array( bytes ) ) )
    .replace( /\+/g, `-` )
    .replace( /\//g, `_` )
    .replace( /=+$/, `` )

const random_string = ( byte_count = 32 ) => base64url( crypto.getRandomValues( new Uint8Array( byte_count ) ) )

export const pkce_challenge = async verifier => base64url( await crypto.subtle.digest( `SHA-256`, new TextEncoder().encode( verifier ) ) )

// ── Flow ─────────────────────────────────────────────────────────

/**
 * Build the authorize URL and remember the verifier + where to come back to
 * @param {string} [return_to] - In-app path to land on after signing in
 * @returns {Promise<string>}
 */
export const build_authorize_url = async ( return_to = `${ window.location.pathname }${ window.location.search }` ) => {

    const verifier = random_string( 48 )
    const state = random_string( 16 )
    sessionStorage.setItem( PENDING_KEY, JSON.stringify( { verifier, state, return_to } ) )

    const params = new URLSearchParams( {
        response_type: `code`,
        client_id: GRATIS_CLIENT_ID,
        redirect_uri: redirect_uri(),
        scope: SCOPE,
        state,
        code_challenge: await pkce_challenge( verifier ),
        code_challenge_method: `S256`,
    } )

    return `${ GRATIS_BASE_URL }/authorize?${ params }`

}

/** Leave the app for the Gratis sign-in page */
export const start_sign_in = async return_to => {
    window.location.assign( await build_authorize_url( return_to ) )
}

const post_token = async fields => {

    const response = await fetch( `${ GRATIS_BASE_URL }/oauth/token`, {
        method: `POST`,
        headers: { 'Content-Type': `application/x-www-form-urlencoded` },
        body: new URLSearchParams( { client_id: GRATIS_CLIENT_ID, ...fields } ),
    } )

    const body = await response.json().catch( () => ( {} ) )
    if( !response.ok ) {
        const error = new Error( body?.error_description || body?.error?.message || body?.error || `Sign-in failed (${ response.status })` )
        error.status = response.status
        throw error
    }
    return body

}

/**
 * Finish the redirect: check state, trade the code for tokens
 * @param {URLSearchParams} params - The callback's query string
 * @returns {Promise<string>} The in-app path to return to
 */
export const finish_sign_in = async params => {

    const pending = JSON.parse( sessionStorage.getItem( PENDING_KEY ) || `null` )
    sessionStorage.removeItem( PENDING_KEY )

    if( params.get( `error` ) ) throw new Error( params.get( `error_description` ) || params.get( `error` ) )
    if( !pending || params.get( `state` ) !== pending.state ) throw new Error( `Sign-in expired or was started in another tab. Please try again.` )

    const tokens = await post_token( {
        grant_type: `authorization_code`,
        code: params.get( `code` ),
        redirect_uri: redirect_uri(),
        code_verifier: pending.verifier,
    } )

    write_session( tokens )
    log.info( `[gratis] Signed in` )
    return pending.return_to || `/`

}

// One refresh at a time: rotation invalidates the old refresh token
let refreshing = null

/**
 * A valid access token, refreshed when close to expiry
 * @returns {Promise<string>}
 */
export const get_access_token = async () => {

    const session = read_session()
    if( !session ) throw new SignInRequiredError()
    if( session.expires_at - EXPIRY_MARGIN_MS > Date.now() ) return session.access_token
    if( !session.refresh_token ) {
        clear_session()
        throw new SignInRequiredError()
    }

    refreshing ||= post_token( { grant_type: `refresh_token`, refresh_token: session.refresh_token } )
        .then( write_session )
        .catch( err => {

            // A rejected grant (expired after 14 idle days, revoked) needs a fresh sign-in
            if( err.status === 400 || err.status === 401 ) {
                clear_session()
                throw new SignInRequiredError( `Your Gratis session expired. Sign in again to use Pro models.` )
            }
            throw err

        } )
        .finally( () => refreshing = null )

    const { access_token } = await refreshing
    return access_token

}

/** Revoke the refresh token (best effort) and forget the session */
export const sign_out = async () => {

    const session = read_session()
    clear_session()
    if( !session?.refresh_token ) return

    await fetch( `${ GRATIS_BASE_URL }/oauth/token`, {
        method: `POST`,
        headers: { 'Content-Type': `application/x-www-form-urlencoded` },
        body: new URLSearchParams( { client_id: GRATIS_CLIENT_ID, token: session.refresh_token, token_type_hint: `refresh_token` } ),
    } ).catch( err => log.warn( `[gratis] Revoke failed:`, err.message ) )

}

/**
 * Authenticated fetch against the Gratis API
 * @param {string} path - e.g. `/v1/usage`
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export const gratis_fetch = async ( path, options = {} ) => {

    const token = await get_access_token()
    const response = await fetch( `${ GRATIS_BASE_URL }${ path }`, {
        ...options,
        headers: { ...options.headers, Authorization: `Bearer ${ token }` },
    } )

    // The server no longer accepts this token: drop it so the UI asks to sign in
    if( response.status === 401 ) {
        clear_session()
        throw new SignInRequiredError( `Your Gratis session expired. Sign in again to use Pro models.` )
    }
    return response

}
