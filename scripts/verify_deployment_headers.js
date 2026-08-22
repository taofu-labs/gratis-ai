import { setTimeout as wait } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { log } from 'mentie'

export const DEPLOYMENT_TARGETS = [
    {
        path: `/`,
        headers: {
            'cross-origin-opener-policy': `same-origin`,
            'cross-origin-embedder-policy': `require-corp`,
        },
    },
    {
        path: `/chat`,
        headers: {
            'cross-origin-opener-policy': `same-origin`,
            'cross-origin-embedder-policy': `require-corp`,
        },
    },
    {
        path: `/wasm/wllama.wasm`,
        headers: {
            'cross-origin-opener-policy': `same-origin`,
            'cross-origin-embedder-policy': `require-corp`,
        },
    },
    {
        path: `/speedtest/1mib.bin`,
        headers: {
            'cross-origin-opener-policy': `same-origin`,
            'cross-origin-embedder-policy': `require-corp`,
            'access-control-allow-origin': `*`,
            'cross-origin-resource-policy': `cross-origin`,
        },
    },
]

/**
 * Returns required response headers that do not match exactly.
 * @param {Headers} headers - Response headers to inspect
 * @param {Object<string, string>} expected - Required lowercase names and values
 * @returns {Array<{name: string, expected: string, actual: string|null}>}
 */
export const find_missing_headers = ( headers, expected ) => Object.entries( expected )
    .map( ( [ name, value ] ) => ( { name, expected: value, actual: headers.get( name ) } ) )
    .filter( ( { expected: value, actual } ) => actual?.toLowerCase() !== value.toLowerCase() )

/**
 * Fetches one deployment URL and verifies its status and security headers.
 * @param {string} url - Cache-busted URL to verify
 * @param {Object<string, string>} expected - Required lowercase header names and values
 * @param {Function} fetch_impl - Fetch implementation, injectable for unit tests
 * @returns {Promise<Array<{name: string, expected: string, actual: string|null}>>}
 */
export const verify_url = async ( url, expected, fetch_impl=fetch ) => {

    const response = await fetch_impl( url, {
        cache: `no-store`,
        headers: { 'cache-control': `no-cache` },
        redirect: `follow`,
    } )

    await response.body?.cancel()

    if( !response.ok ) throw new Error( `${ url } returned HTTP ${ response.status }` )
    return find_missing_headers( response.headers, expected )

}

/**
 * Polls one deployment origin until every representative asset has the
 * `_headers` contract required by wllama64 Memory64.
 * @param {string} origin - Workers or custom-domain origin
 * @param {Object} options - Retry and dependency options
 * @param {number} options.attempts - Maximum verification attempts
 * @param {number} options.delay_ms - Delay between attempts
 * @param {Function} options.fetch_impl - Fetch implementation
 * @param {Array<Object>} options.targets - Paths and expected headers
 * @returns {Promise<void>}
 */
export const verify_origin = async ( origin, {
    attempts=12,
    delay_ms=5_000,
    fetch_impl=fetch,
    targets=DEPLOYMENT_TARGETS,
} = {} ) => {

    const base_url = new URL( origin )
    let latest_errors = []

    for( let attempt = 1; attempt <= attempts; attempt++ ) {

        const verification_id = `${ process.env.GITHUB_SHA || Date.now() }-${ attempt }`
        const results = await Promise.all( targets.map( async ( { path, headers } ) => {

            const url = new URL( path, base_url )
            url.searchParams.set( `verify`, verification_id )

            try {
                const missing = await verify_url( url.href, headers, fetch_impl )
                return missing.length ? { path, missing } : null
            } catch ( error ) {
                return { path, error: error.message }
            }

        } ) )

        latest_errors = results.filter( Boolean )
        if( !latest_errors.length ) {
            log.info( `Deployment headers verified: ${ base_url.origin }` )
            return
        }

        if( attempt < attempts ) await wait( delay_ms )

    }

    throw new Error( `Required deployment headers missing from ${ base_url.origin }: ${ JSON.stringify( latest_errors ) }` )

}

/**
 * Verifies every non-empty deployment origin exactly once.
 * @param {string[]} origins - Workers and custom-domain origins
 * @param {Object} options - Options forwarded to verify_origin
 * @returns {Promise<void>}
 */
export const verify_deployments = async ( origins, options ) => {
    const unique_origins = [ ...new Set( origins.filter( Boolean ) ) ]
    if( !unique_origins.length ) throw new Error( `Provide at least one deployment origin` )
    await Promise.all( unique_origins.map( origin => verify_origin( origin, options ) ) )
}

const is_cli = process.argv[ 1 ] && import.meta.url === pathToFileURL( process.argv[ 1 ] ).href

if( is_cli ) {
    verify_deployments( process.argv.slice( 2 ) ).catch( error => {
        log.error( error.message )
        process.exitCode = 1
    } )
}
