// Fill the App Store listing through the App Store Connect API: localized text,
// categories, age rating, review contact, price, availability, build and screenshots.
// Idempotent: re-running updates in place and replaces screenshots.
//
// Usage: node scripts/store_apple.mjs <screenshots-dir> [--no-screenshots]
// Reads: store/copy.json, store/apple.json; screenshots from scripts/store_compose.mjs

import { createHash } from 'crypto'
import { readFileSync, readdirSync, statSync } from 'fs'
import { api, env, token } from './app_store_connect.js'

const [ SHOTS ] = process.argv.slice( 2 ).filter( arg => !arg.startsWith( `--` ) )
const SKIP_SHOTS = process.argv.includes( `--no-screenshots` )
const COPY = JSON.parse( readFileSync( `store/copy.json`, `utf8` ) )
const SETTINGS = JSON.parse( readFileSync( `store/apple.json`, `utf8` ) )
const APP = env.ASC_APP_ID
const log = ( ...parts ) => console.log( `•`, ...parts )

// ─── App-level: content rights, categories, name / subtitle / privacy URL ──────

await api( `/apps/${ APP }`, { method: `PATCH`, body: { type: `apps`, id: APP, attributes: { contentRightsDeclaration: SETTINGS.content_rights } } } )

const [ info ] = await api( `/apps/${ APP }/appInfos` )
await api( `/appInfos/${ info.id }`, { method: `PATCH`, body: { type: `appInfos`, id: info.id, relationships: {
    primaryCategory: { data: { type: `appCategories`, id: SETTINGS.primary_category } },
    secondaryCategory: { data: { type: `appCategories`, id: SETTINGS.secondary_category } },
} } } )
log( `categories`, SETTINGS.primary_category, SETTINGS.secondary_category )

for( const [ , { apple_locale: locale, apple } ] of Object.entries( COPY ) ) {
    const attributes = { name: apple.name, subtitle: apple.subtitle, privacyPolicyUrl: SETTINGS.privacy_url }
    const existing = ( await api( `/appInfos/${ info.id }/appInfoLocalizations?limit=50` ) ).find( item => item.attributes.locale === locale )
    if( existing ) await api( `/appInfoLocalizations/${ existing.id }`, { method: `PATCH`, body: { type: `appInfoLocalizations`, id: existing.id, attributes } } )
    else await api( `/appInfoLocalizations`, { method: `POST`, body: { type: `appInfoLocalizations`, attributes: { ...attributes, locale },
        relationships: { appInfo: { data: { type: `appInfos`, id: info.id } } } } } )
    log( `app info`, locale )
}


// ─── Age rating ───────────────────────────────────────────────────────────────

const age = await api( `/appInfos/${ info.id }/ageRatingDeclaration` )
await api( `/ageRatingDeclarations/${ age.id }`, { method: `PATCH`, body: { type: `ageRatingDeclarations`, id: age.id, attributes: SETTINGS.age_rating } } )
log( `age rating declaration` )


// ─── Version: number, copyright, build, review contact ────────────────────────

const [ version ] = ( await api( `/apps/${ APP }/appStoreVersions?filter[platform]=IOS` ) )
    .filter( item => [ `PREPARE_FOR_SUBMISSION`, `DEVELOPER_REJECTED`, `REJECTED`, `METADATA_REJECTED` ].includes( item.attributes.appStoreState ) )
const [ build ] = await api( `/builds?filter[app]=${ APP }&filter[version]=${ SETTINGS.build }&filter[processingState]=VALID` )
if( !build ) throw new Error( `Build ${ SETTINGS.build } is not VALID yet` )

await api( `/appStoreVersions/${ version.id }`, { method: `PATCH`, body: { type: `appStoreVersions`, id: version.id,
    attributes: { versionString: SETTINGS.version, copyright: SETTINGS.copyright, releaseType: `MANUAL` },
    relationships: { build: { data: { type: `builds`, id: build.id } } },
} } )
log( `version`, SETTINGS.version, `build`, SETTINGS.build )

const review = await api( `/appStoreVersions/${ version.id }/appStoreReviewDetail` ).catch( () => null )
const review_attributes = { ...SETTINGS.review, demoAccountRequired: false }
if( review ) await api( `/appStoreReviewDetails/${ review.id }`, { method: `PATCH`, body: { type: `appStoreReviewDetails`, id: review.id, attributes: review_attributes } } )
else await api( `/appStoreReviewDetails`, { method: `POST`, body: { type: `appStoreReviewDetails`, attributes: review_attributes,
    relationships: { appStoreVersion: { data: { type: `appStoreVersions`, id: version.id } } } } } )
log( `review contact` )


// ─── Localized version text ───────────────────────────────────────────────────

const version_localizations = {}
for( const [ , { apple_locale: locale, apple } ] of Object.entries( COPY ) ) {
    const attributes = { description: apple.description, keywords: apple.keywords, promotionalText: apple.promotional_text,
        supportUrl: SETTINGS.support_url, marketingUrl: SETTINGS.marketing_url }
    const list = await api( `/appStoreVersions/${ version.id }/appStoreVersionLocalizations?limit=50` )
    const existing = list.find( item => item.attributes.locale === locale )
    version_localizations[ locale ] = existing
        ? await api( `/appStoreVersionLocalizations/${ existing.id }`, { method: `PATCH`, body: { type: `appStoreVersionLocalizations`, id: existing.id, attributes } } )
        : await api( `/appStoreVersionLocalizations`, { method: `POST`, body: { type: `appStoreVersionLocalizations`, attributes: { ...attributes, locale },
            relationships: { appStoreVersion: { data: { type: `appStoreVersions`, id: version.id } } } } } )
    log( `description`, locale )
}


// ─── Price (free) and availability (everywhere but excluded territories) ──────

const [ free ] = ( await api( `/apps/${ APP }/appPricePoints?filter[territory]=USA&limit=1` ) ).filter( point => point.attributes.customerPrice === `0.0` )

// The price schedule needs an "included" appPrices entry; send the raw JSON:API document
const raw = async ( path, document ) => {
    const response = await fetch( `https://api.appstoreconnect.apple.com${ path.startsWith( `/v2/` ) ? `` : `/v1` }${ path }`, {
        method: `POST`, headers: { authorization: `Bearer ${ token() }`, 'content-type': `application/json` }, body: JSON.stringify( document ) } )
    if( !response.ok && response.status !== 409 ) throw new Error( `POST ${ path }: ${ response.status } ${ await response.text() }` )
    return response.status
}

log( `price`, await raw( `/appPriceSchedules`, {
    data: { type: `appPriceSchedules`, relationships: {
        app: { data: { type: `apps`, id: APP } },
        baseTerritory: { data: { type: `territories`, id: `USA` } },
        manualPrices: { data: [ { type: `appPrices`, id: `${ '${' }free}` } ] },
    } },
    included: [ { type: `appPrices`, id: `${ '${' }free}`, attributes: { startDate: null },
        relationships: { appPricePoint: { data: { type: `appPricePoints`, id: free.id } } } } ],
} ) )

const territories = await api( `/territories?limit=200` )
const availability = territories.map( ( { id } ) => ( { type: `territoryAvailabilities`, id: `${ '${' }${ id }}`,
    attributes: { available: !SETTINGS.excluded_territories.includes( id ), releaseDate: null, preOrderEnabled: false },
    relationships: { territory: { data: { type: `territories`, id } } } } ) )
log( `availability`, await raw( `/v2/appAvailabilities`, {
    data: { type: `appAvailabilities`, attributes: { availableInNewTerritories: true }, relationships: {
        app: { data: { type: `apps`, id: APP } },
        territoryAvailabilities: { data: availability.map( ( { type, id } ) => ( { type, id } ) ) },
    } },
    included: availability,
} ), `excluded:`, SETTINGS.excluded_territories.join( `,` ) )


// ─── Screenshots ──────────────────────────────────────────────────────────────

const upload_screenshot = async ( set_id, path ) => {

    const bytes = readFileSync( path )
    const name = path.split( `/` ).slice( -3 ).join( `-` )
    const shot = await api( `/appScreenshots`, { method: `POST`, body: { type: `appScreenshots`,
        attributes: { fileName: name, fileSize: statSync( path ).size },
        relationships: { appScreenshotSet: { data: { type: `appScreenshotSets`, id: set_id } } } } } )

    // Apple hands out byte ranges; PUT each one where it says
    for( const { method, url, offset, length, requestHeaders } of shot.attributes.uploadOperations ) {
        const headers = Object.fromEntries( requestHeaders.map( ( { name, value } ) => [ name, value ] ) )
        const response = await fetch( url, { method, headers, body: bytes.subarray( offset, offset + length ) } )
        if( !response.ok ) throw new Error( `upload ${ name }: ${ response.status }` )
    }

    await api( `/appScreenshots/${ shot.id }`, { method: `PATCH`, body: { type: `appScreenshots`, id: shot.id,
        attributes: { uploaded: true, sourceFileChecksum: createHash( `md5` ).update( bytes ).digest( `hex` ) } } } )
}

if( !SKIP_SHOTS ) for( const [ lang, { apple_locale: locale } ] of Object.entries( COPY ) ) {

    const localization = version_localizations[ locale ]
    for( const [ device, display_type ] of Object.entries( SETTINGS.screenshot_types ) ) {

        const dir = `${ SHOTS }/${ device }/${ lang }`
        const files = readdirSync( dir ).filter( file => file.endsWith( `.png` ) ).sort()
        const sets = await api( `/appStoreVersionLocalizations/${ localization.id }/appScreenshotSets` )
        const set = sets.find( item => item.attributes.screenshotDisplayType === display_type )
            || await api( `/appScreenshotSets`, { method: `POST`, body: { type: `appScreenshotSets`, attributes: { screenshotDisplayType: display_type },
                relationships: { appStoreVersionLocalization: { data: { type: `appStoreVersionLocalizations`, id: localization.id } } } } } )

        // Replace whatever was there
        for( const old of await api( `/appScreenshotSets/${ set.id }/appScreenshots` ) ) await api( `/appScreenshots/${ old.id }`, { method: `DELETE` } )
        for( const file of files ) await upload_screenshot( set.id, `${ dir }/${ file }` )
        log( `screenshots`, locale, display_type, files.length )
    }
}

log( `done` )
