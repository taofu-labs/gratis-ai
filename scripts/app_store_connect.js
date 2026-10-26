// App Store Connect API client shared by the iOS scripts: ES256 JWT from the
// team's API key, JSON:API requests, and the signing.env they all read.
//
// Needs: .secrets/apple/signing.env + the .p8 it names (see DOCUMENTATION.md)

import { createPrivateKey, sign } from 'crypto'
import { readFileSync } from 'fs'

export const DIR = `.secrets/apple`
export const BUNDLE_ID = `com.trueperformancenetwork.gratis`
const API = `https://api.appstoreconnect.apple.com/v1`

export const env = Object.fromEntries( readFileSync( `${ DIR }/signing.env`, `utf8` )
    .split( `\n` ).filter( line => line.includes( `=` ) )
    .map( line => line.split( /=(.*)/s ).slice( 0, 2 ) ) )

/** ES256 JWT, valid 15 minutes (Apple caps it at 20) */
export const token = () => {
    const encode = value => Buffer.from( JSON.stringify( value ) ).toString( `base64url` )
    const now = Math.floor( Date.now() / 1000 )
    const header = encode( { alg: `ES256`, kid: env.ASC_KEY_ID, typ: `JWT` } )
    const claims = encode( { iss: env.ASC_ISSUER_ID, iat: now, exp: now + 900, aud: `appstoreconnect-v1` } )
    const key = createPrivateKey( readFileSync( env.ASC_KEY_PATH ) )
    const signature = sign( `sha256`, Buffer.from( `${ header }.${ claims }` ), { key, dsaEncoding: `ieee-p1363` } )
    return `${ header }.${ claims }.${ signature.toString( `base64url` ) }`
}

/**
 * One API call; throws with Apple's error body on failure
 * @param {string} path - After /v1, e.g. `/certificates?limit=200`
 * @param {{ method?: string, body?: Object }} [options] - `body` is the JSON:API `data` object
 * @returns {Promise<Object|Object[]|null>} The response's `data`
 */
export const api = async ( path, { method = `GET`, body } = {} ) => {
    const response = await fetch( `${ API }${ path }`, {
        method,
        headers: { authorization: `Bearer ${ token() }`, 'content-type': `application/json` },
        body: body && JSON.stringify( { data: body } ),
    } )
    if( !response.ok ) throw new Error( `${ method } ${ path }: ${ response.status } ${ await response.text() }` )
    return response.status === 204 ? null : ( await response.json() ).data
}
