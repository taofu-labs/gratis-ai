// Development signing for the iOS app through the App Store Connect API:
// an Apple Development certificate (private key stays in .secrets/apple) and
// a development profile covering every enabled iPhone/iPad on the team.
//
// Usage: node scripts/ios_signing.js
// Needs: .secrets/apple/signing.env + the .p8 it names (see DOCUMENTATION.md)
// Writes: .secrets/apple/{dev.key, dev.cer, dev.p12, dev.p12.password, Gratis_Development.mobileprovision}
//
// Idempotent: reuses the certificate while Apple still lists it, replaces the
// profile every run so newly registered devices are included.

import { execFileSync } from 'child_process'
import { createPrivateKey, randomBytes, sign } from 'crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'fs'

const DIR = `.secrets/apple`
const BUNDLE_ID = `com.trueperformancenetwork.gratis`
const PROFILE_NAME = `Gratis Development`
const API = `https://api.appstoreconnect.apple.com/v1`

const env = Object.fromEntries( readFileSync( `${ DIR }/signing.env`, `utf8` )
    .split( `\n` ).filter( line => line.includes( `=` ) )
    .map( line => line.split( /=(.*)/s ).slice( 0, 2 ) ) )

const openssl = ( args, env = {} ) => execFileSync( `openssl`, args, { stdio: [ `pipe`, `pipe`, `inherit` ], env: { ...process.env, ...env } } )
const write_secret = ( file, data ) => writeFileSync( `${ DIR }/${ file }`, data, { mode: 0o600 } )


// ─── API ──────────────────────────────────────────────────────────────────────

/** ES256 JWT, valid 15 minutes (Apple caps it at 20) */
const token = () => {
    const encode = value => Buffer.from( JSON.stringify( value ) ).toString( `base64url` )
    const now = Math.floor( Date.now() / 1000 )
    const header = encode( { alg: `ES256`, kid: env.ASC_KEY_ID, typ: `JWT` } )
    const claims = encode( { iss: env.ASC_ISSUER_ID, iat: now, exp: now + 900, aud: `appstoreconnect-v1` } )
    const key = createPrivateKey( readFileSync( env.ASC_KEY_PATH ) )
    const signature = sign( `sha256`, Buffer.from( `${ header }.${ claims }` ), { key, dsaEncoding: `ieee-p1363` } )
    return `${ header }.${ claims }.${ signature.toString( `base64url` ) }`
}

const api = async ( path, { method = `GET`, body } = {} ) => {
    const response = await fetch( `${ API }${ path }`, {
        method,
        headers: { authorization: `Bearer ${ token() }`, 'content-type': `application/json` },
        body: body && JSON.stringify( { data: body } ),
    } )
    if( !response.ok ) throw new Error( `${ method } ${ path }: ${ response.status } ${ await response.text() }` )
    return response.status === 204 ? null : ( await response.json() ).data
}


// ─── Certificate ──────────────────────────────────────────────────────────────

/** Serial of a DER certificate, as Apple lists it (uppercase hex, no colons) */
const serial_of = file => openssl( [ `x509`, `-inform`, `DER`, `-in`, file, `-noout`, `-serial` ] )
    .toString().trim().split( `=` )[ 1 ].replace( /^0+/, `` ).toUpperCase()

const ensure_certificate = async () => {

    const listed = await api( `/certificates?filter[certificateType]=DEVELOPMENT&limit=200` )
    const cer = `${ DIR }/dev.cer`

    // Reuse ours while it is still active on the team
    if( existsSync( cer ) && existsSync( `${ DIR }/dev.key` ) ) {
        const serial = serial_of( cer )
        const match = listed.find( cert => cert.attributes.serialNumber.replace( /^0+/, `` ).toUpperCase() === serial )
        if( match && new Date( match.attributes.expirationDate ) > new Date() ) return match
        console.log( `Certificate ${ serial } is gone or expired: creating a new one` )
    }

    if( !existsSync( `${ DIR }/dev.key` ) ) openssl( [ `genrsa`, `-out`, `${ DIR }/dev.key`, `2048` ] )
    const csr = openssl( [ `req`, `-new`, `-key`, `${ DIR }/dev.key`, `-subj`, `/CN=Gratis CI/O=Taofu B.V./C=NL` ] ).toString()

    const created = await api( `/certificates`, { method: `POST`, body: {
        type: `certificates`,
        attributes: { certificateType: `DEVELOPMENT`, csrContent: csr },
    } } )
    write_secret( `dev.cer`, Buffer.from( created.attributes.certificateContent, `base64` ) )
    return created

}

/** .p12 with legacy SHA1/3DES encryption: macOS `security import` rejects OpenSSL 3's defaults */
const export_p12 = () => {
    // Keep the password across runs so the CI secret only changes with the profile
    const password_file = `${ DIR }/dev.p12.password`
    const password = existsSync( password_file ) ? readFileSync( password_file, `utf8` ).trim() : randomBytes( 18 ).toString( `base64url` )
    openssl( [ `x509`, `-inform`, `DER`, `-in`, `${ DIR }/dev.cer`, `-out`, `${ DIR }/dev.pem` ] )
    chmodSync( `${ DIR }/dev.pem`, 0o600 )
    // Password via the environment: never in argv or an error message
    openssl( [ `pkcs12`, `-export`, `-inkey`, `${ DIR }/dev.key`, `-in`, `${ DIR }/dev.pem`, `-out`, `${ DIR }/dev.p12`,
        `-name`, `Gratis Development`, `-passout`, `env:P12_PASSWORD`,
        `-keypbe`, `PBE-SHA1-3DES`, `-certpbe`, `PBE-SHA1-3DES`, `-macalg`, `sha1` ], { P12_PASSWORD: password } )
    chmodSync( `${ DIR }/dev.p12`, 0o600 )
    write_secret( `dev.p12.password`, password )
}


// ─── Profile ──────────────────────────────────────────────────────────────────

const create_profile = async certificate => {

    const [ bundle ] = await api( `/bundleIds?filter[identifier]=${ BUNDLE_ID }` )
    if( !bundle ) throw new Error( `Bundle ID ${ BUNDLE_ID } is not registered on the team` )

    const devices = ( await api( `/devices?filter[status]=ENABLED&limit=200` ) )
        .filter( device => [ `IPHONE`, `IPAD` ].includes( device.attributes.deviceClass ) )

    // Profiles are immutable: replace the previous one
    const existing = await api( `/profiles?filter[name]=${ encodeURIComponent( PROFILE_NAME ) }` )
    for( const profile of existing ) await api( `/profiles/${ profile.id }`, { method: `DELETE` } )

    const profile = await api( `/profiles`, { method: `POST`, body: {
        type: `profiles`,
        attributes: { name: PROFILE_NAME, profileType: `IOS_APP_DEVELOPMENT` },
        relationships: {
            bundleId: { data: { type: `bundleIds`, id: bundle.id } },
            certificates: { data: [ { type: `certificates`, id: certificate.id } ] },
            devices: { data: devices.map( ( { id } ) => ( { type: `devices`, id } ) ) },
        },
    } } )
    write_secret( `Gratis_Development.mobileprovision`, Buffer.from( profile.attributes.profileContent, `base64` ) )
    return { profile, devices }

}


// ─── Main ─────────────────────────────────────────────────────────────────────

const certificate = await ensure_certificate()
export_p12()
const { profile, devices } = await create_profile( certificate )

console.log( `Certificate: ${ certificate.attributes.name } (expires ${ certificate.attributes.expirationDate })` )
console.log( `Profile:     ${ profile.attributes.name } ${ profile.attributes.uuid }, ${ devices.length } device(s):` )
devices.forEach( ( { attributes: { name, udid } } ) => console.log( `             ${ name } ${ udid }` ) )
console.log( `Files:       ${ DIR }/dev.p12 (+ dev.p12.password), ${ DIR }/Gratis_Development.mobileprovision` )
