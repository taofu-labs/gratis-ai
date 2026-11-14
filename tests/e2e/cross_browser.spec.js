import { test as base, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { MODELS, LONG_PROMPT, TEST_PROMPT } from '../fixtures/test_models'
import { download_model_via_ui, send_message } from '../helpers/download_model'
import { wait_for_inference } from '../helpers/wait_for_inference'

// One real user journey per browser engine, run by the `smoke-<engine>`
// projects: first visit → download the smallest model → chat → stop → reload →
// settings → theme. Each engine runs it twice: on the runtime it picks by
// itself, and on the wasm32 compat runtime that older browsers fall back to.

const DEEP_BLUE = `rgb(0, 43, 54)`

// Console errors that are not defects:
// - Firefox logs one per wasm thread when a reload tears down the inference
//   workers mid-flight. A worker dying while in use fails the chat steps instead
// - WebKit reports the viewport key that Chrome Android needs for its keyboard
const BENIGN_ERRORS = [
    /uncaught exception: undefined" \{file: "blob:/,
    /Viewport argument key "interactive-widget" not recognized/,
]

const test = base.extend( {

    // A real on-disk profile: Playwright's default incognito context has a tiny
    // OPFS quota, and WebKit's has no OPFS at all, so no model could be stored.
    // Launch options (headless, switches) still come from the project config
    context: async ( { playwright, browserName, baseURL, viewport }, use, test_info ) => {

        const profile = test_info.outputPath( `profile` )
        const context = await playwright[ browserName ].launchPersistentContext( profile, { baseURL, viewport } )
        await use( context )
        await context.close()

    },

    page: async ( { context }, use ) => use( context.pages()[ 0 ] || await context.newPage() ),

} )

/**
 * Collect what a user would see as breakage in devtools: uncaught exceptions
 * and console errors.
 * @param {import('@playwright/test').Page} page
 * @returns {{ errors: string[], logs: string[] }}
 */
const watch_console = page => {

    const errors = []
    const logs = []
    page.on( `pageerror`, error => errors.push( `pageerror: ${ error.message }` ) )
    page.on( `console`, message => {
        // Firefox reports React's dev-mode performance marks as console events
        if( message.type() === `timeStamp` ) return
        logs.push( message.text() )
        const benign = BENIGN_ERRORS.some( pattern => pattern.test( message.text() ) )
        if( message.type() === `error` && !benign ) errors.push( `console: ${ message.text() }` )
    } )
    return { errors, logs }

}

/**
 * What the engine itself supports, before any app code decides anything.
 * @param {import('@playwright/test').Page} page
 */
const engine_features = page => page.evaluate( () => {

    let memory64 = false
    try {
        new WebAssembly.Memory( { address: `i64`, initial: 1n, maximum: 2n, shared: true } )
        memory64 = true
    } catch { /* wasm32-only engine */ }

    return {
        isolated: globalThis.crossOriginIsolated === true,
        jspi: typeof WebAssembly.Suspending === `function`,
        memory64,
        user_agent: navigator.userAgent,
    }

} )

/**
 * The journey itself, one step per thing a user does.
 * @param {import('@playwright/test').Page} page
 * @param {Object} expected
 * @param {RegExp} expected.runtime - Runtime name in the provider's load log
 * @param {string[]} expected.logs - Live console lines of the page
 * @param {import('@playwright/test').TestInfo} test_info
 */
const journey_steps = async ( page, { runtime, logs }, test_info ) => {

    const assistant_messages = page.getByTestId( `assistant-message` )

    await test.step( `first visit: download the smallest model and load it`, async () => {

        await download_model_via_ui( page, MODELS.smollm2 )

        const features = await engine_features( page )
        test_info.annotations.push( { type: `engine`, description: JSON.stringify( features ) } )
        expect( features.isolated ).toBe( true )

        // The provider logs the runtime it ended up on (mentie: localhost only)
        const loaded = logs.find( line => line.includes( `[wllama] Loaded` ) )
        test_info.annotations.push( { type: `runtime`, description: loaded } )
        expect( loaded ).toMatch( runtime )

    } )

    await test.step( `chat gets a reply`, async () => {

        await send_message( page, TEST_PROMPT )
        await wait_for_inference( page, 1, 300_000 )

    } )

    await test.step( `stop keeps the partial reply and frees the composer`, async () => {

        await send_message( page, LONG_PROMPT )

        // Real tokens, not the prompt-reading indicator
        const reply = assistant_messages.last()
        await expect( assistant_messages ).toHaveCount( 2, { timeout: 300_000 } )
        await expect( reply.getByTestId( `reading-indicator` ) ).toHaveCount( 0, { timeout: 300_000 } )
        await expect( reply ).not.toBeEmpty()

        await page.getByTestId( `stop-btn` ).click()
        await expect( page.getByTestId( `stop-btn` ) ).toHaveCount( 0 )
        await expect( page.getByTestId( `chat-input` ) ).toBeEnabled()
        await expect( reply ).not.toBeEmpty()

    } )

    await test.step( `reload keeps the model and the conversation`, async () => {

        await page.reload()

        // No second download: the stored model loads straight into the chat
        await expect( page.getByTestId( `chat-input` ) ).toBeEnabled( { timeout: 300_000 } )
        await expect( page ).not.toHaveURL( /\/download/ )

        const conversation = page.locator( `[data-testid^="sidebar-conversation-"]` ).first()
        await expect( conversation ).toBeVisible()
        await conversation.click()
        await expect( page.getByTestId( `user-message` ) ).toHaveCount( 2 )
        await expect( assistant_messages ).toHaveCount( 2 )

        await send_message( page, `Say hello.` )
        await wait_for_inference( page, 1, 300_000 )

    } )

    await test.step( `settings persist and the theme follows the device`, async () => {

        await page.getByTestId( `settings-btn` ).click()
        await page.getByTestId( `system-prompt-input` ).fill( `Answer briefly.` )
        await page.keyboard.press( `Escape` )
        await expect( page.getByTestId( `settings-modal` ) ).toHaveCount( 0 )

        await page.emulateMedia( { colorScheme: `dark` } )
        await expect.poll( () => page.evaluate( () => getComputedStyle( document.body ).backgroundColor ) ).toBe( DEEP_BLUE )

        await page.reload()
        await page.getByTestId( `settings-btn` ).click()
        await expect( page.getByTestId( `system-prompt-input` ) ).toHaveValue( `Answer briefly.` )

    } )

}

/**
 * Run the journey and require a clean console.
 * @param {import('@playwright/test').Page} page
 * @param {Object} expected
 * @param {RegExp} expected.runtime - Runtime name in the provider's load log
 * @param {import('@playwright/test').TestInfo} test_info
 */
const user_journey = async ( page, expected, test_info ) => {

    const { errors, logs } = watch_console( page )

    // A failed step is diagnosed from the console, so attach it either way
    try {
        await journey_steps( page, { ...expected, logs }, test_info )
    } finally {
        const path = test_info.outputPath( `console.log` )
        writeFileSync( path, logs.join( `\n` ) )
        await test_info.attach( `console.log`, { path } )
    }

    expect( errors ).toEqual( [] )

}

test.describe( `Cross-browser journey`, () => {

    test( `on the runtime the browser picks itself`, async ( { page }, test_info ) => {

        // Chromium, Firefox ≥ 153 and Safari ≥ 26 ship Memory64 + JSPI
        await user_journey( page, { runtime: /Memory64/ }, test_info )

    } )

    test( `on the wasm32 compat runtime of older browsers`, async ( { page }, test_info ) => {

        // No JSPI is what sends older Firefox/Safari down the compat path
        await page.addInitScript( () => {
            delete WebAssembly.Suspending
        } )
        await user_journey( page, { runtime: /wasm32 compatibility/ }, test_info )

    } )

} )
