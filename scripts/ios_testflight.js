// Sign the CI's unsigned iOS build for the App Store and upload it to
// TestFlight, without a Mac: zsign + the App Store Connect build upload API.
//
// Usage: node scripts/ios_testflight.js path/to/gratis-unsigned.ipa [--tester email]…
// Needs: vendor/zsign, and `node scripts/ios_signing.js --distribution` once
//
// Steps: sign → reserve an upload → PUT each part → commit → wait for Apple to
// process it → hand the build to the internal "Gratis internal" TestFlight group.
// --tester adds App Store Connect users (internal testers must be team members) to that group.

import { execFileSync } from 'child_process'
import { mkdtempSync, openSync, readSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { BUNDLE_ID, DIR, api } from './app_store_connect.js'

const ZSIGN = `vendor/zsign/src/bin/zsign`
const GROUP_NAME = `Gratis internal`
const POLL_MS = 30_000
const PROCESSING_LIMIT_MS = 60 * 60_000

const args = process.argv.slice( 2 )
const testers = args.flatMap( ( arg, index ) => arg === `--tester` ? [ args[ index + 1 ] ] : [] )
const [ unsigned ] = args.filter( ( arg, index ) => !arg.startsWith( `--` ) && args[ index - 1 ] !== `--tester` )
if( !unsigned ) throw new Error( `Usage: node scripts/ios_testflight.js <unsigned.ipa> [--tester email]…` )

const sleep = ms => new Promise( resolve => setTimeout( resolve, ms ) )


// ─── Sign ─────────────────────────────────────────────────────────────────────

/** Version and build number from the app's Info.plist (binary plist → python plistlib) */
const read_versions = ipa => {
    const script = `import plistlib, sys, zipfile
z = zipfile.ZipFile( sys.argv[ 1 ] )
name = next( n for n in z.namelist() if n.count( '/' ) == 2 and n.endswith( '.app/Info.plist' ) )
p = plistlib.loads( z.read( name ) )
print( p[ 'CFBundleShortVersionString' ], p[ 'CFBundleVersion' ], p[ 'CFBundleIdentifier' ] )`
    const [ version, build, bundle_id ] = execFileSync( `python3`, [ `-I`, `-c`, script, ipa ] ).toString().trim().split( ` ` )
    return { version, build, bundle_id }
}

const sign_ipa = () => {
    const output = join( mkdtempSync( join( tmpdir(), `gratis-testflight-` ) ), `Gratis.ipa` )
    // Unencrypted PEM key + cert: no password on the command line
    execFileSync( ZSIGN, [
        `-k`, `${ DIR }/dist.key`,
        `-c`, `${ DIR }/dist.pem`,
        `-m`, `${ DIR }/Gratis_App_Store.mobileprovision`,
        `-z`, `9`,
        `-o`, output,
        unsigned,
    ], { stdio: [ `ignore`, `inherit`, `inherit` ] } )
    return output
}


// ─── Upload ───────────────────────────────────────────────────────────────────

/** Bytes [offset, offset + length) of a file */
const read_range = ( path, offset, length ) => {
    const buffer = Buffer.alloc( length )
    const fd = openSync( path, `r` )
    readSync( fd, buffer, 0, length, offset )
    return buffer
}

const upload = async ( ipa, app, { version, build } ) => {

    const build_upload = await api( `/buildUploads`, { method: `POST`, body: {
        type: `buildUploads`,
        attributes: { cfBundleShortVersionString: version, cfBundleVersion: build, platform: `IOS` },
        relationships: { app: { data: { type: `apps`, id: app.id } } },
    } } )

    const file = await api( `/buildUploadFiles`, { method: `POST`, body: {
        type: `buildUploadFiles`,
        attributes: { fileName: basename( ipa ), fileSize: statSync( ipa ).size, assetType: `ASSET`, uti: `com.apple.ipa` },
        relationships: { buildUpload: { data: { type: `buildUploads`, id: build_upload.id } } },
    } } )

    // Pre-signed part URLs: no API token on these
    for( const operation of file.attributes.uploadOperations ) {
        const headers = Object.fromEntries( ( operation.requestHeaders || [] ).map( ( { name, value } ) => [ name, value ] ) )
        const response = await fetch( operation.url, { method: operation.method, headers, body: read_range( ipa, operation.offset, operation.length ) } )
        if( !response.ok ) throw new Error( `Part at ${ operation.offset }: ${ response.status } ${ await response.text() }` )
    }

    await api( `/buildUploadFiles/${ file.id }`, { method: `PATCH`, body: { type: `buildUploadFiles`, id: file.id, attributes: { uploaded: true } } } )
    return build_upload

}

/** Wait until Apple accepts or rejects the upload; returns the processed build */
const wait_for_build = async ( build_upload, app, { build } ) => {

    const deadline = Date.now() + PROCESSING_LIMIT_MS
    while( Date.now() < deadline ) {

        const { attributes } = await api( `/buildUploads/${ build_upload.id }` )
        const state = attributes.state?.state || attributes.state
        console.log( `  upload state: ${ JSON.stringify( state ) }` )

        if( state === `FAILED` ) throw new Error( `Apple rejected the build: ${ JSON.stringify( attributes.state, null, 2 ) }` )

        const [ processed ] = await api( `/builds?filter[app]=${ app.id }&filter[version]=${ build }&limit=1` )
        if( processed?.attributes.processingState === `VALID` ) return processed
        if( processed?.attributes.processingState === `INVALID` ) throw new Error( `Build ${ build } failed processing` )

        await sleep( POLL_MS )

    }
    throw new Error( `Build ${ build } still processing after ${ PROCESSING_LIMIT_MS / 60_000 } minutes` )

}


// ─── TestFlight ───────────────────────────────────────────────────────────────

/** The internal group that gets every build, created on first use */
const ensure_internal_group = async app => {
    const groups = await api( `/apps/${ app.id }/betaGroups` )
    const existing = groups.find( ( { attributes } ) => attributes.name === GROUP_NAME )
    if( existing ) return existing
    return api( `/betaGroups`, { method: `POST`, body: {
        type: `betaGroups`,
        attributes: { name: GROUP_NAME, isInternalGroup: true, hasAccessToAllBuilds: true },
        relationships: { app: { data: { type: `apps`, id: app.id } } },
    } } )
}


/** Add team members to the group; Apple emails each a TestFlight invite */
const add_testers = async group => {

    const members = await api( `/betaGroups/${ group.id }/betaTesters?limit=200` )
    const users = await api( `/users?limit=200` )

    for( const email of testers ) {
        if( members.some( ( { attributes } ) => attributes.email === email ) ) continue
        const user = users.find( ( { attributes } ) => attributes.username === email )
        if( !user ) throw new Error( `${ email } is not an App Store Connect user; internal testers must be` )
        await api( `/betaTesters`, { method: `POST`, body: {
            type: `betaTesters`,
            attributes: { email, firstName: user.attributes.firstName, lastName: user.attributes.lastName },
            relationships: { betaGroups: { data: [ { type: `betaGroups`, id: group.id } ] } },
        } } )
        console.log( `  added tester ${ email }` )
    }

}


// ─── Main ─────────────────────────────────────────────────────────────────────

const versions = read_versions( unsigned )
if( versions.bundle_id !== BUNDLE_ID ) throw new Error( `Unexpected bundle id ${ versions.bundle_id }` )
console.log( `Gratis ${ versions.version } (${ versions.build })` )

const [ app ] = await api( `/apps?filter[bundleId]=${ BUNDLE_ID }` )
if( !app ) throw new Error( `No App Store Connect app for ${ BUNDLE_ID }` )

const ipa = sign_ipa()
console.log( `Signed: ${ ipa }` )

const build_upload = await upload( ipa, app, versions )
console.log( `Uploaded; waiting for Apple to process build ${ versions.build }…` )

const build = await wait_for_build( build_upload, app, versions )
const group = await ensure_internal_group( app )
await add_testers( group )
console.log( `TestFlight: build ${ build.attributes.version } is VALID; internal group "${ group.attributes.name }" sees every build` )
