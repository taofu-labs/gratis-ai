// Sign an Android App Bundle with the Play upload key and release it to the
// Play Console's internal testing track.
//
// Usage: node scripts/play_internal.js path/to/app-release.aab [--draft]
// Needs: .secrets/android/{upload.jks,keystore.properties}, .secrets/google/play-service-account.json, jarsigner
//
// Unsigned bundles (CI without the keystore secret) are signed here first; an
// already signed one is uploaded as-is. Apps Google still treats as drafts
// only accept draft releases: pass --draft, then roll out in the Play Console.

import { execFileSync } from 'child_process'
import { createSign } from 'crypto'
import { copyFileSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const PACKAGE = `com.trueperformancenetwork.gratis`
const TRACK = `internal`
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${ PACKAGE }`
const UPLOAD_API = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${ PACKAGE }`

const [ aab_input ] = process.argv.slice( 2 ).filter( arg => !arg.startsWith( `--` ) )
const draft = process.argv.includes( `--draft` )
if( !aab_input ) throw new Error( `Usage: node scripts/play_internal.js <app-release.aab> [--draft]` )

const properties = Object.fromEntries( readFileSync( `.secrets/android/keystore.properties`, `utf8` )
    .split( `\n` ).filter( line => line.includes( `=` ) )
    .map( line => line.split( /=(.*)/s ).slice( 0, 2 ).map( part => part.trim() ) ) )


// ─── Sign ─────────────────────────────────────────────────────────────────────

const is_signed = aab => {
    try {
        return /jar verified/.test( execFileSync( `jarsigner`, [ `-verify`, aab ] ).toString() )
    } catch {
        return false
    }
}

const sign_bundle = () => {

    if( is_signed( aab_input ) ) return aab_input

    const aab = join( mkdtempSync( join( tmpdir(), `gratis-play-` ) ), `app-release.aab` )
    copyFileSync( aab_input, aab )

    // Passwords through the environment, never argv
    execFileSync( `jarsigner`, [
        `-keystore`, `.secrets/android/upload.jks`,
        `-storepass:env`, `STORE_PASSWORD`,
        `-keypass:env`, `KEY_PASSWORD`,
        `-sigalg`, `SHA256withRSA`, `-digestalg`, `SHA-256`,
        aab, properties.keyAlias,
    ], { env: { ...process.env, STORE_PASSWORD: properties.storePassword, KEY_PASSWORD: properties.keyPassword }, stdio: [ `ignore`, `ignore`, `inherit` ] } )

    if( !is_signed( aab ) ) throw new Error( `jarsigner did not produce a verifiable bundle` )
    return aab

}


// ─── Play Developer API ───────────────────────────────────────────────────────

/** OAuth access token from the service account (JWT bearer grant) */
const access_token = async () => {

    const account = JSON.parse( readFileSync( `.secrets/google/play-service-account.json`, `utf8` ) )
    const encode = value => Buffer.from( JSON.stringify( value ) ).toString( `base64url` )
    const now = Math.floor( Date.now() / 1000 )
    const unsigned = `${ encode( { alg: `RS256`, typ: `JWT` } ) }.${ encode( {
        iss: account.client_email,
        scope: `https://www.googleapis.com/auth/androidpublisher`,
        aud: account.token_uri,
        iat: now,
        exp: now + 3600,
    } ) }`
    const signature = createSign( `RSA-SHA256` ).update( unsigned ).sign( account.private_key, `base64url` )

    const response = await fetch( account.token_uri, {
        method: `POST`,
        headers: { 'content-type': `application/x-www-form-urlencoded` },
        body: new URLSearchParams( { grant_type: `urn:ietf:params:oauth:grant-type:jwt-bearer`, assertion: `${ unsigned }.${ signature }` } ),
    } )
    if( !response.ok ) throw new Error( `Token: ${ response.status } ${ await response.text() }` )
    return ( await response.json() ).access_token

}

const call = async ( token, url, { method = `GET`, body, raw } = {} ) => {
    const response = await fetch( url, {
        method,
        headers: { authorization: `Bearer ${ token }`, 'content-type': raw ? `application/octet-stream` : `application/json` },
        body: raw || ( body && JSON.stringify( body ) ),
    } )
    if( !response.ok ) throw new Error( `${ method } ${ url.replace( API, `` ) }: ${ response.status } ${ await response.text() }` )
    return response.json()
}


// ─── Main ─────────────────────────────────────────────────────────────────────

const aab = sign_bundle()
const token = await access_token()

// One edit: upload the bundle, point the internal track at it, commit
const edit = await call( token, `${ API }/edits`, { method: `POST`, body: {} } )
const bundle = await call( token, `${ UPLOAD_API }/edits/${ edit.id }/bundles?uploadType=media`, { method: `POST`, raw: readFileSync( aab ) } )
console.log( `Uploaded bundle, versionCode ${ bundle.versionCode }` )

const version = JSON.parse( readFileSync( `package.json`, `utf8` ) ).version
await call( token, `${ API }/edits/${ edit.id }/tracks/${ TRACK }`, { method: `PUT`, body: {
    track: TRACK,
    releases: [ { name: `${ version } (${ bundle.versionCode })`, versionCodes: [ String( bundle.versionCode ) ], status: draft ? `draft` : `completed` } ],
} } )
await call( token, `${ API }/edits/${ edit.id }:commit`, { method: `POST` } )

console.log( `Play ${ TRACK } track: ${ version } (${ bundle.versionCode }) ${ draft ? `saved as a draft — roll it out in the Play Console` : `released to internal testers` }` )
