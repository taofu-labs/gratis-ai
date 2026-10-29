// Signing for the Mac App Store build through the App Store Connect API, no Mac needed.
//
// - Mac App Distribution certificate ("3rd Party Mac Developer Application"): signs the .app
// - Mac Installer Distribution certificate ("3rd Party Mac Developer Installer"): signs the .pkg
// - Mac App Store provisioning profile for the bundle id, embedded in the .app
//
// Usage: node scripts/mac_app_store_signing.js
// Writes: .secrets/apple/mas_{app,installer}.{key,cer,pem,p12,p12.password},
//         .secrets/apple/Gratis_Mac_App_Store.provisionprofile,
//         .secrets/handoff/mas_github_secrets.txt (GitHub Actions secrets for release-mac-app-store.yml)
//
// Idempotent: reuses each certificate while Apple still lists it, replaces the
// profile every run (profiles are immutable). Same pattern as scripts/ios_signing.js.

import { execFileSync } from 'child_process'
import { randomBytes } from 'crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { BUNDLE_ID, DIR, api, env } from './app_store_connect.js'

const HANDOFF = `.secrets/handoff/mas_github_secrets.txt`
const PROFILE_NAME = `Gratis Mac App Store`
const PROFILE_FILE = `${ DIR }/Gratis_Mac_App_Store.provisionprofile`

const CERTIFICATES = {
    app: { prefix: `mas_app`, certificate_type: `MAC_APP_DISTRIBUTION`, identity: `Gratis Mac App Distribution` },
    installer: { prefix: `mas_installer`, certificate_type: `MAC_INSTALLER_DISTRIBUTION`, identity: `Gratis Mac Installer Distribution` },
}

const file = ( { prefix }, extension ) => `${ DIR }/${ prefix }.${ extension }`

const openssl = ( args, extra_env = {} ) => execFileSync( `openssl`, args, { stdio: [ `pipe`, `pipe`, `inherit` ], env: { ...process.env, ...extra_env } } )
const write_secret = ( path, data ) => writeFileSync( path, data, { mode: 0o600 } )


// ─── Preflight: can this bundle id ship on the Mac App Store at all? ──────────

/**
 * The bundle id must be UNIVERSAL or MAC_OS to get a Mac profile (an IOS-only id never can:
 * its platform is fixed). The app record needs the macOS platform before any upload; only
 * warned about here, because adding it changes the store listing
 */
const preflight = async () => {

    const [ bundle ] = await api( `/bundleIds?filter[identifier]=${ BUNDLE_ID }` )
    if( !bundle ) throw new Error( `Bundle ID ${ BUNDLE_ID } is not registered on the team` )

    const { platform } = bundle.attributes
    console.log( `Bundle ID:   ${ BUNDLE_ID } (${ bundle.id }), platform ${ platform }` )
    if( ![ `UNIVERSAL`, `MAC_OS` ].includes( platform ) ) throw new Error( `Bundle ID platform is ${ platform }: Apple cannot issue a Mac App Store profile for it. Register a new UNIVERSAL/macOS App ID in developer.apple.com → Identifiers` )

    const mac_versions = await api( `/apps/${ env.ASC_APP_ID }/appStoreVersions?filter[platform]=MAC_OS&limit=1` )
    if( !mac_versions.length ) console.warn( `WARNING:     App ${ env.ASC_APP_ID } has no macOS platform yet: uploads are rejected until a human adds it (App Store Connect → Apps → Gratis AI → sidebar "+" next to iOS App → macOS)` )

    return bundle

}


// ─── Certificates ─────────────────────────────────────────────────────────────

/** Serial of a DER certificate, as Apple lists it (uppercase hex, no colons) */
const serial_of = path => openssl( [ `x509`, `-inform`, `DER`, `-in`, path, `-noout`, `-serial` ] )
    .toString().trim().split( `=` )[ 1 ].replace( /^0+/, `` ).toUpperCase()

/**
 * Reuse our certificate of this type while Apple lists it and it has not expired, else create one
 * @param {Object} kind - Entry of CERTIFICATES
 * @returns {Promise<Object>} The API certificate resource
 */
const ensure_certificate = async kind => {

    const listed = await api( `/certificates?filter[certificateType]=${ kind.certificate_type }&limit=200` )

    if( existsSync( file( kind, `cer` ) ) && existsSync( file( kind, `key` ) ) ) {
        const serial = serial_of( file( kind, `cer` ) )
        const match = listed.find( cert => cert.attributes.serialNumber.replace( /^0+/, `` ).toUpperCase() === serial )
        if( match && new Date( match.attributes.expirationDate ) > new Date() ) return match
        console.log( `${ kind.certificate_type } ${ serial } is gone or expired: creating a new one` )
    }

    if( !existsSync( file( kind, `key` ) ) ) openssl( [ `genrsa`, `-out`, file( kind, `key` ), `2048` ] )
    chmodSync( file( kind, `key` ), 0o600 )
    const csr = openssl( [ `req`, `-new`, `-key`, file( kind, `key` ), `-subj`, `/CN=Gratis CI/O=Taofu B.V./C=NL` ] ).toString()

    const created = await api( `/certificates`, { method: `POST`, body: {
        type: `certificates`,
        attributes: { certificateType: kind.certificate_type, csrContent: csr },
    } } )
    write_secret( file( kind, `cer` ), Buffer.from( created.attributes.certificateContent, `base64` ) )
    return created

}

/**
 * Password-protected .p12 with legacy SHA1/3DES encryption: macOS `security import`
 * (electron-builder's CSC_LINK keychain) rejects OpenSSL 3's defaults
 * @returns {string} The .p12 password, kept across runs so the CI secret only changes with the cert
 */
const export_p12 = kind => {
    const password_file = file( kind, `p12.password` )
    const password = existsSync( password_file ) ? readFileSync( password_file, `utf8` ).trim() : randomBytes( 18 ).toString( `base64url` )
    openssl( [ `x509`, `-inform`, `DER`, `-in`, file( kind, `cer` ), `-out`, file( kind, `pem` ) ] )
    chmodSync( file( kind, `pem` ), 0o600 )
    // Password via the environment: never in argv or an error message
    openssl( [ `pkcs12`, `-export`, `-inkey`, file( kind, `key` ), `-in`, file( kind, `pem` ), `-out`, file( kind, `p12` ),
        `-name`, kind.identity, `-passout`, `env:P12_PASSWORD`,
        `-keypbe`, `PBE-SHA1-3DES`, `-certpbe`, `PBE-SHA1-3DES`, `-macalg`, `sha1` ], { P12_PASSWORD: password } )
    chmodSync( file( kind, `p12` ), 0o600 )
    write_secret( password_file, password )
    return password
}

/** Keychain identity name electron-builder will look for, e.g. "3rd Party Mac Developer Installer: Taofu B.V. (2GQT3SY42B)" */
const common_name = kind => openssl( [ `x509`, `-in`, file( kind, `pem` ), `-noout`, `-subject`, `-nameopt`, `multiline` ] )
    .toString().match( /commonName\s*=\s*(.+)/ )?.[ 1 ].trim()


// ─── Profile ──────────────────────────────────────────────────────────────────

/** Replace the Mac App Store profile (bundle id + app certificate, no devices) */
const create_profile = async ( bundle, certificate ) => {

    const existing = await api( `/profiles?filter[name]=${ encodeURIComponent( PROFILE_NAME ) }` )
    for( const profile of existing ) await api( `/profiles/${ profile.id }`, { method: `DELETE` } )

    const profile = await api( `/profiles`, { method: `POST`, body: {
        type: `profiles`,
        attributes: { name: PROFILE_NAME, profileType: `MAC_APP_STORE` },
        relationships: {
            bundleId: { data: { type: `bundleIds`, id: bundle.id } },
            certificates: { data: [ { type: `certificates`, id: certificate.id } ] },
        },
    } } )
    write_secret( PROFILE_FILE, Buffer.from( profile.attributes.profileContent, `base64` ) )
    return profile

}


// ─── Handoff ──────────────────────────────────────────────────────────────────

/** GitHub Actions secrets for release-mac-app-store.yml, one NAME=value per line */
const write_handoff = passwords => {

    const base64 = path => readFileSync( path ).toString( `base64` )
    const lines = [
        `# Add each as a repository Actions secret in taofu-labs/gratis-ai (name = left of the first =)`,
        `# Used by .github/workflows/release-mac-app-store.yml. Regenerate with: node scripts/mac_app_store_signing.js`,
        `# MAS_PROVISIONING_PROFILE_BASE64 changes on every run of that script: update it each time`,
        `MAS_APP_P12_BASE64=${ base64( file( CERTIFICATES.app, `p12` ) ) }`,
        `MAS_APP_P12_PASSWORD=${ passwords.app }`,
        `MAS_INSTALLER_P12_BASE64=${ base64( file( CERTIFICATES.installer, `p12` ) ) }`,
        `MAS_INSTALLER_P12_PASSWORD=${ passwords.installer }`,
        `MAS_PROVISIONING_PROFILE_BASE64=${ base64( PROFILE_FILE ) }`,
        `ASC_KEY_ID=${ env.ASC_KEY_ID }`,
        `ASC_ISSUER_ID=${ env.ASC_ISSUER_ID }`,
        `ASC_KEY_P8_BASE64=${ base64( env.ASC_KEY_PATH ) }`,
    ]

    mkdirSync( `.secrets/handoff`, { recursive: true } )
    write_secret( HANDOFF, `${ lines.join( `\n` ) }\n` )

}


// ─── Main ─────────────────────────────────────────────────────────────────────

const bundle = await preflight()

const certificates = {}
const passwords = {}
for( const [ name, kind ] of Object.entries( CERTIFICATES ) ) {
    certificates[ name ] = await ensure_certificate( kind )
    passwords[ name ] = export_p12( kind )
}

const profile = await create_profile( bundle, certificates.app )
write_handoff( passwords )

for( const [ name, kind ] of Object.entries( CERTIFICATES ) ) {
    const { attributes } = certificates[ name ]
    console.log( `Certificate: ${ common_name( kind ) } [${ kind.certificate_type }] (expires ${ attributes.expirationDate })` )
}
console.log( `Profile:     ${ profile.attributes.name } ${ profile.attributes.uuid } (${ profile.attributes.platform }, expires ${ profile.attributes.expirationDate })` )
console.log( `Files:       ${ DIR }/mas_{app,installer}.{p12,p12.password,key,pem,cer}, ${ PROFILE_FILE }` )
console.log( `Handoff:     ${ HANDOFF }` )
