// macOS window lifecycle check (App Review Guideline 4): close → Window → Show Gratis AI → Dock → Quit.
// Drives the running main process over the Node inspector, asserting one window, same webContents,
// renderer state kept. Cmd-W needs a focused key window: verify it by hand (unlocked screen).
//
// Usage (on the Mac): open Gratis.app --args --inspect=127.0.0.1:9339 && node scripts/mac_window_check.mjs
// Needs a mas-dev / dev build (distribution-signed MAS apps don't launch outside the store).
const [ list ] = await ( await fetch( `http://127.0.0.1:9339/json/list` ) ).json()
const ws = new WebSocket( list.webSocketDebuggerUrl )
await new Promise( r => ws.onopen = r )
let seq = 0
const pending = new Map()
ws.onmessage = ( { data } ) => {
    const msg = JSON.parse( data )
    pending.get( msg.id )?.( msg )
}
const evaluate = async expression => {
    const id = ++seq
    ws.send( JSON.stringify( { id, method: `Runtime.evaluate`, params: { expression, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true } } ) )
    const msg = await new Promise( r => pending.set( id, r ) )
    if( msg.result?.exceptionDetails ) throw new Error( JSON.stringify( msg.result.exceptionDetails ) )
    return msg.result?.result?.value
}
const wait = ms => new Promise( r => setTimeout( r, ms ) )

// Helpers inside the app
await evaluate( `
    globalThis.E = require( 'electron' )
    globalThis.win = () => E.BrowserWindow.getAllWindows()
    globalThis.state = async () => {
        const all = win()
        const w = all[ 0 ]
        return { windows: all.length, visible: w?.isVisible(), id: w?.id, wc: w?.webContents.id,
            marker: w ? await w.webContents.executeJavaScript( 'window.__review_marker || null' ) : null }
    }
    globalThis.menu_item = label => E.Menu.getApplicationMenu().items.flatMap( i => i.submenu?.items || [] ).find( i => i.label === label || i.role === label )
    'ok'
` )

let first
const check = async ( step, expect_visible ) => {
    await wait( 1200 )
    const s = await evaluate( `state()` )
    const ok = s.windows === 1 && s.visible === expect_visible && s.marker === `kept-123` && s.id === first.id && s.wc === first.wc
    console.log( ok ? `PASS` : `FAIL`, step, JSON.stringify( s ) )
    if( !ok ) process.exitCode = 1
}

console.log( `menu:`, JSON.stringify( await evaluate( `E.Menu.getApplicationMenu().items.map( i => [ i.label, ( i.submenu?.items || [] ).map( s => s.label ).filter( Boolean ) ] )` ) ) )

// Renderer state that a reload or new window would lose
await evaluate( `win()[ 0 ].webContents.executeJavaScript( 'window.__review_marker = "kept-123"' )` )
first = await evaluate( `state()` )
console.log( `start`, JSON.stringify( first ) )

for( const round of [ 1, 2 ] ) {
    // Red button = BrowserWindow close
    await evaluate( `win()[ 0 ].close()` );                                     await check( `r${ round } close (red button path)`, false )
    await evaluate( `menu_item( 'Show Gratis AI' ).click()` );                    await check( `r${ round } Window → Show Gratis AI`, true )
}

// Dock click while hidden
await evaluate( `win()[ 0 ].close()` );                                         await check( `close before Dock`, false )
await evaluate( `E.app.emit( 'activate', {}, false )` );                         await check( `Dock icon (activate)`, true )
// Show while already visible: still one window
await evaluate( `menu_item( 'Show Gratis AI' ).click()` );                        await check( `Show while visible`, true )

// Normal quit
await evaluate( `setTimeout( () => E.app.quit(), 100 ); 'quitting'` ).catch( () => {} )
ws.close()
