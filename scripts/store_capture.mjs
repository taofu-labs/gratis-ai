// Capture raw app screens for the store listings: every language × every device.
// Runs the real app (dev server on :5173) in a persistent browser profile that already
// holds LFM 2.5 1.2B, so home and chat show a genuinely loaded model.
//
// Usage: node scripts/store_capture.mjs <profile-dir> <out-dir> [lang,lang] [device,device]
// Output: <out-dir>/<device>/<lang>/<n>-<screen>.png

import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'fs'

const [ PROFILE, OUT, LANGS_ARG, DEVICES_ARG ] = process.argv.slice( 2 )
const BASE = `http://localhost:5173`
const MODEL = `lfm25-1.2b-tpn-q4km`
const SAMPLES = JSON.parse( readFileSync( `store/chat_samples.json`, `utf8` ) )
const LANGS = LANGS_ARG ? LANGS_ARG.split( `,` ) : Object.keys( SAMPLES )

// Logical sizes of real devices; the composer scales them into the store canvases
const DEVICES = {
    iphone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
        userAgent: `Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1` },
    ipad: { viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
        userAgent: `Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1` },
    android: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
        userAgent: `Mozilla/5.0 (Linux; Android 15; CPH2465) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36` },
}
const DEVICE_NAMES = DEVICES_ARG ? DEVICES_ARG.split( `,` ) : Object.keys( DEVICES )

const settle = page => page.waitForTimeout( 1200 )

// Fresh language + the downloaded model, then a hard reload so i18n picks it up
const open = async ( page, lang, path ) => {
    await page.goto( `${ BASE }/nope` )
    await page.evaluate( ( [ lang, model ] ) => {
        localStorage.setItem( `gratis:settings:language`, lang )
        localStorage.setItem( `gratis:settings:active_model_id`, model )
        localStorage.setItem( `gratis:settings:speed_tip_message`, `shown` )
        localStorage.setItem( `gratis:settings:speed_mode`, `balanced` )
    }, [ lang, MODEL ] )
    await page.goto( `${ BASE }${ path }`, { waitUntil: `networkidle` } )
}

// "<model> — Ready" (home) or an enabled composer (chat) means the model is loaded
const wait_ready = async page => ( await page.waitForTimeout( 2500 ), page.waitForFunction( () => !document.querySelector( `[data-testid="model-load-stage"] [role="status"]` )?.textContent, null, { timeout: 120_000 } ) )

// One conversation in IndexedDB, in the page's language
const seed_chat = ( page, { q, a } ) => page.evaluate( async ( [ q, a ] ) => {
    const db = await new Promise( ( ok, ko ) => {
        const request = indexedDB.open( `gratis-db`, 1 )
        request.onsuccess = () => ok( request.result )
        request.onerror = ko
    } )
    const now = Date.now()
    const tx = db.transaction( [ `conversations`, `messages` ], `readwrite` )
    tx.objectStore( `conversations` ).put( { id: `store-demo`, title: q, created_at: now, updated_at: now, model_id: `lfm25-1.2b-tpn-q4km` } )
    tx.objectStore( `messages` ).put( { id: `store-q`, conversation_id: `store-demo`, role: `user`, content: q, created_at: now - 2000 } )
    tx.objectStore( `messages` ).put( { id: `store-a`, conversation_id: `store-demo`, role: `assistant`, content: a, created_at: now - 1000,
        stats: { tokens_generated: 112, tokens_per_second: 15.2, elapsed_ms: 7400, ttft_ms: 140, model_id: `lfm25-1.2b-tpn-q4km` } } )
    await new Promise( resolve => tx.oncomplete = resolve )
}, [ q, a ] )

const SCREENS = [

    [ `1-home`, async ( page, lang ) => {
        await open( page, lang, `/` )
        await wait_ready( page )
    } ],

    [ `2-chat`, async ( page, lang ) => {
        await open( page, lang, `/` )
        await seed_chat( page, SAMPLES[ lang ] )
        await page.goto( `${ BASE }/chat/store-demo`, { waitUntil: `networkidle` } )
        await page.getByTestId( `assistant-message` ).first().waitFor()
        await wait_ready( page )
        await page.locator( `textarea` ).first().blur()
    } ],

    [ `3-picker`, async ( page, lang ) => {
        await open( page, lang, `/select-model` )
        const skip = page.getByTestId( `wizard-skip` )
        const hero = page.getByTestId( `model-hero` )
        await skip.or( hero ).first().waitFor( { timeout: 60_000 } )
        // Answer like a typical user: text only, careful, balanced (or quickest when no balanced pick exists)
        const edit_speed = page.getByTestId( `wizard-edit-speed` )
        if( await edit_speed.isVisible().catch( () => false ) ) await edit_speed.click()
        for( const testid of [ `wizard-photos-photos_no`, `wizard-topics-topics_careful`, `wizard-speed-speed_balanced`, `wizard-speed-speed_faster` ] ) {
            const option = page.getByTestId( testid )
            if( await option.isVisible().catch( () => false ) ) await option.click()
            await page.waitForTimeout( 500 )
        }
        await hero.waitFor( { timeout: 60_000 } )
    } ],

    // A real download of a small model, captured mid-way, then cancelled
    [ `4-download`, async ( page, lang ) => {
        await open( page, lang, `/nope` )
        await page.evaluate( async () => {
            const { get_model_by_id } = await import( `/src/utils/model_catalog.js` )
            history.pushState( { usr: { model: get_model_by_id( `smollm2-360m-q4km` ), return_to: `/` }, key: `store`, idx: 1 }, ``, `/download` )
            dispatchEvent( new PopStateEvent( `popstate`, { state: history.state } ) )
        } )
        await page.waitForFunction( () => {
            const percent = [ ...document.querySelectorAll( `span` ) ].map( span => span.textContent ).find( text => /^\d+%$/.test( text ) )
            return parseInt( percent ) >= 38
        }, null, { timeout: 120_000, polling: 100 } )
    }, async page => {
        await page.getByTestId( `cancel-download-btn` ).click().catch( () => {} )
        await page.waitForTimeout( 1000 )
    } ],

    [ `5-dark`, async ( page, lang ) => {
        await page.emulateMedia( { colorScheme: `dark` } )
        await open( page, lang, `/` )
        await seed_chat( page, SAMPLES[ lang ] )
        await page.goto( `${ BASE }/chat/store-demo`, { waitUntil: `networkidle` } )
        await page.getByTestId( `assistant-message` ).first().waitFor()
        await wait_ready( page )
    }, async page => page.emulateMedia( { colorScheme: `light` } ) ],

]

for( const name of DEVICE_NAMES ) {

    const ctx = await chromium.launchPersistentContext( PROFILE, { ...DEVICES[ name ], colorScheme: `light`, reducedMotion: `no-preference` } )
    const page = ctx.pages()[ 0 ] || await ctx.newPage()

    // Look like the shipped app: a phone-class RAM report (the native apps read the OS),
    // and no "Install app" pill (native apps never show it)
    await ctx.addInitScript( () => {
        Object.defineProperty( navigator, `deviceMemory`, { get: () => 8 } )
        document.addEventListener( `DOMContentLoaded`, () => {
            const style = document.createElement( `style` )
            style.textContent = `[data-testid="install-app-pill"] { display: none !important; }`
            document.head.append( style )
        } )
    } )

    for( const lang of LANGS ) {
        const dir = `${ OUT }/${ name }/${ lang }`
        mkdirSync( dir, { recursive: true } )
        for( const [ screen, prepare, cleanup ] of SCREENS ) {
            try {
                await prepare( page, lang )
                await settle( page )
                await page.screenshot( { path: `${ dir }/${ screen }.png` } )
                console.log( `✓ ${ name } ${ lang } ${ screen }` )
            } catch( error ) {
                console.log( `✗ ${ name } ${ lang } ${ screen }: ${ error.message.split( `\n` )[ 0 ] }` )
            }
            await cleanup?.( page )
        }
    }

    await ctx.close()
}
