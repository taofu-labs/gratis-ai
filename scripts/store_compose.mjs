// Frame raw app captures into store screenshots: localized caption above the app screen.
// Captions come from store/copy.json; raw shots from scripts/store_capture.mjs.
//
// Usage: node scripts/store_compose.mjs <raw-dir> <out-dir>
// Output: <out-dir>/<device>/<lang>/<n>.png at each store's exact pixel size

import { chromium } from 'playwright'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const [ RAW, OUT ] = process.argv.slice( 2 ).map( dir => resolve( dir ) )
const COPY = JSON.parse( readFileSync( `store/copy.json`, `utf8` ) )

// Store canvas per capture device
const CANVAS = {
    iphone: { width: 1320, height: 2868 },     // App Store 6.9" iPhone
    ipad: { width: 2064, height: 2752 },       // App Store 13" iPad
    android: { width: 1080, height: 2160 },    // Play phone, 2:1
    mac: { width: 2880, height: 1800 },        // Mac App Store, 16:10
}

// Page colours from src/styles/theme.js; screen 5 is the dark-mode shot
const LIGHT = { page: `#F7F6F2`, ink: `#131517`, muted: `#4F545B`, line: `#CFCEC7` }
const DARK = { page: `#002B36`, ink: `#E6ECF0`, muted: `#AAB6C1`, line: `#1D5566` }

// Montserrat subsets from @fontsource, CJK falls back to Noto
const fonts = [ `latin`, `latin-ext`, `cyrillic`, `cyrillic-ext` ]
    .map( subset => `@font-face { font-family: 'Montserrat'; font-weight: 100 900; src: url( 'file://${ resolve( `node_modules/@fontsource-variable/montserrat/files/montserrat-${ subset }-wght-normal.woff2` ) }' ); }` )
    .join( `\n` )

const escape = text => text.replace( /&/g, `&amp;` ).replace( /</g, `&lt;` )

const page_html = ( { width, height }, shot, caption, colors, lang ) => `<!doctype html><html><head><meta charset="utf-8"><style>
${ fonts }
* { margin: 0; box-sizing: border-box; }
html, body { width: ${ width }px; height: ${ height }px; background: ${ colors.page }; overflow: hidden; }
body { display: flex; flex-direction: column; align-items: center; padding: ${ height * 0.055 }px ${ width * 0.07 }px 0; }
h1 {
    font: 600 ${ Math.min( width, height ) * 0.064 }px/1.18 'Montserrat', 'Noto Sans CJK JP', 'Noto Sans CJK SC', sans-serif;
    letter-spacing: -0.01em; color: ${ colors.ink }; text-align: center; text-wrap: balance; word-break: auto-phrase;
    min-height: ${ height * ( width > height ? 0.14 : 0.11 ) }px; display: flex; align-items: center;
}
.screen {
    margin-top: ${ height * 0.035 }px; width: ${ width * 0.84 }px; flex: 1;
    border: ${ Math.round( width / 400 ) }px solid ${ colors.line }; border-bottom: none;
    border-radius: ${ width * 0.05 }px ${ width * 0.05 }px 0 0; overflow: hidden;
    background: url( 'file://${ shot }' ) top center / 100% auto no-repeat;
    box-shadow: 0 ${ width * 0.01 }px ${ width * 0.04 }px rgba( 19, 21, 23, 0.10 );
}
</style></head><body><h1 lang="${ lang }">${ escape( caption ) }</h1><div class="screen"></div></body></html>`

const browser = await chromium.launch()
const page = await browser.newPage()

for( const device of readdirSync( RAW ) ) {

    if( !CANVAS[ device ] ) continue
    const size = CANVAS[ device ]
    await page.setViewportSize( size )

    for( const lang of readdirSync( `${ RAW }/${ device }` ) ) {

        const captions = COPY[ lang ]?.captions
        if( !captions ) continue
        const dir = `${ OUT }/${ device }/${ lang }`
        mkdirSync( dir, { recursive: true } )

        for( const shot of readdirSync( `${ RAW }/${ device }/${ lang }` ).sort() ) {
            const index = parseInt( shot ) - 1
            const colors = shot.includes( `dark` ) ? DARK : LIGHT
            const html = `${ dir }/.frame.html`
            writeFileSync( html, page_html( size, `${ RAW }/${ device }/${ lang }/${ shot }`, captions[ index ], colors, lang ) )
            await page.goto( `file://${ html }` )
            await page.evaluate( () => document.fonts.ready )
            await page.screenshot( { path: `${ dir }/${ index + 1 }.png` } )
        }

        rmSync( `${ dir }/.frame.html`, { force: true } )
        console.log( `✓ ${ device } ${ lang }` )
    }
}

await browser.close()
