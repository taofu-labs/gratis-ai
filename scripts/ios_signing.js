// Signing for the iOS app through the App Store Connect API.
//
// - Default: an Apple Development certificate and a development profile
//   covering every enabled iPhone/iPad on the team (direct installs)
// - --distribution: an Apple Distribution certificate and an App Store
//   profile (TestFlight / App Store uploads, see scripts/ios_testflight.js)
//
// Private keys stay in .secrets/apple. Usage: node scripts/ios_signing.js [--distribution]
// Writes: .secrets/apple/{dev|dist}.{key,cer,pem,p12,p12.password} + the profile
//
// Idempotent: reuses the certificate while Apple still lists it, replaces the
// profile every run so newly registered devices are included.

import { execFileSync } from 'child_process'
import { randomBytes } from 'crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { BUNDLE_ID, DIR, api } from './app_store_connect.js'

const KINDS = {
    development: {
        prefix: `dev`,
        certificate_type: `DEVELOPMENT`,
        identity: `Gratis Development`,
        profile_type: `IOS_APP_DEVELOPMENT`,
        profile_name: `Gratis Development`,
        profile_file: `Gratis_Development.mobileprovision`,
        with_devices: true,
    },
    distribution: {
        prefix: `dist`,
        certificate_type: `DISTRIBUTION`,
        identity: `Gratis Distribution`,
        profile_type: `IOS_APP_STORE`,
        profile_name: `Gratis App Store`,
        profile_file: `Gratis_App_Store.mobileprovision`,
        with_devices: false,
    },
}

const kind = KINDS[ process.argv.includes( `--distribution` ) ? `distribution` : `development` ]
const file = extension => `${ DIR }/${ kind.prefix }.${ extension }`

const openssl = ( args, env = {} ) => execFileSync( `openssl`, args, { stdio: [ `pipe`, `pipe`, `inherit` ], env: { ...process.env, ...env } } )
const write_secret = ( path, data ) => writeFileSync( path, data, { mode: 0o600 } )


// ─── Certificate ──────────────────────────────────────────────────────────────

/** Serial of a DER certificate, as Apple lists it (uppercase hex, no colons) */
const serial_of = path => openssl( [ `x509`, `-inform`, `DER`, `-in`, path, `-noout`, `-serial` ] )
    .toString().trim().split( `=` )[ 1 ].replace( /^0+/, `` ).toUpperCase()

const ensure_certificate = async () => {

    const listed = await api( `/certificates?filter[certificateType]=${ kind.certificate_type }&limit=200` )

    // Reuse ours while it is still active on the team
    if( existsSync( file( `cer` ) ) && existsSync( file( `key` ) ) ) {
        const serial = serial_of( file( `cer` ) )
        const match = listed.find( cert => cert.attributes.serialNumber.replace( /^0+/, `` ).toUpperCase() === serial )
        if( match && new Date( match.attributes.expirationDate ) > new Date() ) return match
        console.log( `Certificate ${ serial } is gone or expired: creating a new one` )
    }

    if( !existsSync( file( `key` ) ) ) openssl( [ `genrsa`, `-out`, file( `key` ), `2048` ] )
    chmodSync( file( `key` ), 0o600 )
    const csr = openssl( [ `req`, `-new`, `-key`, file( `key` ), `-subj`, `/CN=Gratis CI/O=Taofu B.V./C=NL` ] ).toString()

    const created = await api( `/certificates`, { method: `POST`, body: {
        type: `certificates`,
        attributes: { certificateType: kind.certificate_type, csrContent: csr },
    } } )
    write_secret( file( `cer` ), Buffer.from( created.attributes.certificateContent, `base64` ) )
    return created

}

/** .p12 with legacy SHA1/3DES encryption: macOS `security import` rejects OpenSSL 3's defaults */
const export_p12 = () => {
    // Keep the password across runs so the CI secret only changes with the profile
    const password_file = file( `p12.password` )
    const password = existsSync( password_file ) ? readFileSync( password_file, `utf8` ).trim() : randomBytes( 18 ).toString( `base64url` )
    openssl( [ `x509`, `-inform`, `DER`, `-in`, file( `cer` ), `-out`, file( `pem` ) ] )
    chmodSync( file( `pem` ), 0o600 )
    // Password via the environment: never in argv or an error message
    openssl( [ `pkcs12`, `-export`, `-inkey`, file( `key` ), `-in`, file( `pem` ), `-out`, file( `p12` ),
        `-name`, kind.identity, `-passout`, `env:P12_PASSWORD`,
        `-keypbe`, `PBE-SHA1-3DES`, `-certpbe`, `PBE-SHA1-3DES`, `-macalg`, `sha1` ], { P12_PASSWORD: password } )
    chmodSync( file( `p12` ), 0o600 )
    write_secret( password_file, password )
}


// ─── Profile ──────────────────────────────────────────────────────────────────

const create_profile = async certificate => {

    const [ bundle ] = await api( `/bundleIds?filter[identifier]=${ BUNDLE_ID }` )
    if( !bundle ) throw new Error( `Bundle ID ${ BUNDLE_ID } is not registered on the team` )

    // App Store profiles carry no device list
    const devices = kind.with_devices
        ? ( await api( `/devices?filter[status]=ENABLED&limit=200` ) ).filter( device => [ `IPHONE`, `IPAD` ].includes( device.attributes.deviceClass ) )
        : []

    // Profiles are immutable: replace the previous one
    const existing = await api( `/profiles?filter[name]=${ encodeURIComponent( kind.profile_name ) }` )
    for( const profile of existing ) await api( `/profiles/${ profile.id }`, { method: `DELETE` } )

    const profile = await api( `/profiles`, { method: `POST`, body: {
        type: `profiles`,
        attributes: { name: kind.profile_name, profileType: kind.profile_type },
        relationships: {
            bundleId: { data: { type: `bundleIds`, id: bundle.id } },
            certificates: { data: [ { type: `certificates`, id: certificate.id } ] },
            ... kind.with_devices ? { devices: { data: devices.map( ( { id } ) => ( { type: `devices`, id } ) ) } } : {},
        },
    } } )
    write_secret( `${ DIR }/${ kind.profile_file }`, Buffer.from( profile.attributes.profileContent, `base64` ) )
    return { profile, devices }

}


// ─── Main ─────────────────────────────────────────────────────────────────────

const certificate = await ensure_certificate()
export_p12()
const { profile, devices } = await create_profile( certificate )

console.log( `Certificate: ${ certificate.attributes.name } (expires ${ certificate.attributes.expirationDate })` )
console.log( `Profile:     ${ profile.attributes.name } ${ profile.attributes.uuid }${ kind.with_devices ? `, ${ devices.length } device(s):` : `` }` )
devices.forEach( ( { attributes: { name, udid } } ) => console.log( `             ${ name } ${ udid }` ) )
console.log( `Files:       ${ file( `p12` ) } (+ p12.password, key, pem), ${ DIR }/${ kind.profile_file }` )
