// Fill the Google Play listing through the Android Publisher API: localized text,
// contact details, icon, feature graphic and phone screenshots, in one edit.
//
// Usage: node scripts/store_play.mjs <screenshots-dir> <graphics-dir>
// Reads: store/copy.json, store/play.json, .secrets/google/play-service-account.json

import { createSign } from 'crypto'
import { readFileSync, readdirSync } from 'fs'

const [ SHOTS, GRAPHICS ] = process.argv.slice( 2 )
const COPY = JSON.parse( readFileSync( `store/copy.json`, `utf8` ) )
const SETTINGS = JSON.parse( readFileSync( `store/play.json`, `utf8` ) )
const PACKAGE = `com.trueperformancenetwork.gratis`
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${ PACKAGE }`
const UPLOAD = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${ PACKAGE }`
const log = ( ...parts ) => console.log( `•`, ...parts )

/** OAuth access token from the service account (JWT bearer grant) */
const access_token = async () => {
    const account = JSON.parse( readFileSync( `.secrets/google/play-service-account.json`, `utf8` ) )
    const encode = value => Buffer.from( JSON.stringify( value ) ).toString( `base64url` )
    const now = Math.floor( Date.now() / 1000 )
    const unsigned = `${ encode( { alg: `RS256`, typ: `JWT` } ) }.${ encode( {
        iss: account.client_email, scope: `https://www.googleapis.com/auth/androidpublisher`, aud: account.token_uri, iat: now, exp: now + 3600,
    } ) }`
    const signature = createSign( `RSA-SHA256` ).update( unsigned ).sign( account.private_key, `base64url` )
    const response = await fetch( account.token_uri, { method: `POST`,
        body: new URLSearchParams( { grant_type: `urn:ietf:params:oauth:grant-type:jwt-bearer`, assertion: `${ unsigned }.${ signature }` } ) } )
    return ( await response.json() ).access_token
}

const token = await access_token()
const call = async ( url, { method = `GET`, body, png } = {} ) => {
    const response = await fetch( url, { method,
        headers: { authorization: `Bearer ${ token }`, 'content-type': png ? `image/png` : `application/json` },
        body: png || ( body && JSON.stringify( body ) ) } )
    const text = await response.text()
    if( !response.ok ) throw new Error( `${ method } ${ url.replace( API, `` ) }: ${ response.status } ${ text.slice( 0, 400 ) }` )
    return text ? JSON.parse( text ) : null
}

const edit = await call( `${ API }/edits`, { method: `POST`, body: {} } )
const EDIT = `${ API }/edits/${ edit.id }`
const EDIT_UPLOAD = `${ UPLOAD }/edits/${ edit.id }`

try {

    // Contact details shown on the store page
    await call( `${ EDIT }/details`, { method: `PATCH`, body: SETTINGS.details } )
    log( `details` )

    for( const [ lang, { play_locale: locale, play } ] of Object.entries( COPY ) ) {

        await call( `${ EDIT }/listings/${ locale }`, { method: `PUT`, body: {
            language: locale, title: play.title, shortDescription: play.short_description, fullDescription: play.full_description,
        } } )

        // Replace each image type wholesale
        const images = {
            icon: [ `${ GRAPHICS }/icon-512.png` ],
            featureGraphic: [ `${ GRAPHICS }/feature/${ lang }.png` ],
            phoneScreenshots: readdirSync( `${ SHOTS }/android/${ lang }` ).filter( file => file.endsWith( `.png` ) ).sort().map( file => `${ SHOTS }/android/${ lang }/${ file }` ),
        }
        for( const [ type, files ] of Object.entries( images ) ) {
            await call( `${ EDIT }/listings/${ locale }/${ type }`, { method: `DELETE` } )
            for( const file of files ) await call( `${ EDIT_UPLOAD }/listings/${ locale }/${ type }?uploadType=media`, { method: `POST`, png: readFileSync( file ) } )
        }
        log( `listing`, locale, images.phoneScreenshots.length, `screenshots` )
    }

    // Draft apps can't be sent for review from the API; the edit just saves
    await call( `${ EDIT }:commit?changesNotSentForReview=${ SETTINGS.changes_not_sent_for_review }`, { method: `POST` } )
    log( `committed edit` )

} catch( error ) {
    await call( EDIT, { method: `DELETE` } ).catch( () => {} )
    throw error
}
