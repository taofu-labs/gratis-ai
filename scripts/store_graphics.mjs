// Play Store graphics: 512px icon and a 1024×500 feature graphic per language.
// Usage: node scripts/store_graphics.mjs <out-dir>
// Output: <out-dir>/icon-512.png, <out-dir>/feature/<lang>.png

import { chromium } from 'playwright'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { BODY, LETTERS, OUTLINE } from '../src/components/atoms/brand_paths.js'

const OUT = resolve( process.argv[ 2 ] )
const COPY = JSON.parse( readFileSync( `store/copy.json`, `utf8` ) )
mkdirSync( `${ OUT }/feature`, { recursive: true } )

const wordmark = `<svg viewBox="0 44 2214 680" style="height:120px;display:block"><g transform="translate(0 724) scale(.1 -.1)">
    <path fill="#FFFFFF" d="${ BODY }"/><path fill="#131517" d="${ OUTLINE }"/><path fill="#131517" d="${ LETTERS }"/></g></svg>`
const bunny = `<svg viewBox="1711 45 560 560" style="width:62%;height:62%"><g transform="translate(0 724) scale(.1 -.1)">
    <path fill="#FFFFFF" d="${ BODY }"/><path fill="#131517" d="${ OUTLINE }"/></g></svg>`
const eat_sprite = `file://${ resolve( `src/assets/sprites/eat.png` ) }`

const fonts = [ `latin`, `latin-ext`, `cyrillic`, `cyrillic-ext` ]
    .map( subset => `@font-face { font-family: 'Montserrat'; font-weight: 100 900; src: url( 'file://${ resolve( `node_modules/@fontsource-variable/montserrat/files/montserrat-${ subset }-wght-normal.woff2` ) }' ); }` )
    .join( `\n` )

const browser = await chromium.launch()
const page = await browser.newPage()
const render = async ( size, body, path ) => {
    const html = `${ OUT }/.render.html`
    writeFileSync( html, `<!doctype html><meta charset="utf-8"><style>${ fonts } * { margin: 0; box-sizing: border-box; } html, body { width: ${ size.width }px; height: ${ size.height }px; overflow: hidden; }</style>${ body }` )
    await page.setViewportSize( size )
    await page.goto( `file://${ html }` )
    await page.evaluate( () => document.fonts.ready )
    await page.screenshot( { path } )
    rmSync( html )
}

// Icon: full-bleed orange, Play rounds the corners itself
await render( { width: 512, height: 512 }, `<div style="width:512px;height:512px;background:#FF8A57;display:grid;place-items:center">${ bunny }</div>`, `${ OUT }/icon-512.png` )

// Feature graphic: wordmark + tagline on paper, the carrot-eating bunny on orange
for( const [ lang, { apple: { subtitle } } ] of Object.entries( COPY ) ) {
    await render( { width: 1024, height: 500 }, `
        <div style="display:flex;width:1024px;height:500px;background:#F7F6F2;font-family:Montserrat,'Noto Sans CJK JP','Noto Sans CJK SC',sans-serif">
            <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:0 56px;gap:28px">
                ${ wordmark }
                <p lang="${ lang }" style="font-size:40px;font-weight:600;line-height:1.15;color:#131517;letter-spacing:-0.01em;text-wrap:balance;word-break:auto-phrase">${ subtitle.replace( /&/g, `&amp;` ) }</p>
            </div>
            <div style="width:380px;background:#FF8A57;display:grid;place-items:center;border-left:2px solid #131517">
                <div style="width:420px;height:280px;background:url('${ eat_sprite }') -840px 0 / 2520px 280px no-repeat;image-rendering:pixelated"></div>
            </div>
        </div>`, `${ OUT }/feature/${ lang }.png` )
    console.log( `✓ feature ${ lang }` )
}

await browser.close()
