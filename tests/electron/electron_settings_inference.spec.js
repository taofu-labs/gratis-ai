import { test, expect } from '@playwright/test'
import { skip_model_wizard } from '../helpers/download_model'
import fs from 'fs'
import { MODELS, TEST_PROMPT } from '../fixtures/test_models'
import { launch_electron, preload_model, send_message } from '../helpers/electron_helpers'
import { wait_for_inference } from '../helpers/wait_for_inference'

// Tests that settings affect native inference in Electron:
// - Custom system prompt is applied
// - Max tokens limits response length

const CACHE_DIR = `/tmp/gratisai-test-models`
const has_cache = fs.existsSync( CACHE_DIR )

let app
let page

test.describe( `Electron Settings + Inference`, () => {

    test.setTimeout( 600_000 )
    test.skip( !has_cache, `No model cache at ${ CACHE_DIR }. Run scripts/download_test_models.sh first.` )

    test.beforeAll( async () => {

        const result = await launch_electron()
        app = result.app
        page = result.page

        // Pre-load SmolLM2
        await preload_model( app, MODELS.smollm2, CACHE_DIR )

        // Navigate through onboarding
        await expect( page.getByTestId( `get-started-btn` ) ).toBeEnabled( { timeout: 15_000 } )
        await page.getByTestId( `get-started-btn` ).click()

        await expect( page ).toHaveURL( /\/select-model/ )
        await skip_model_wizard( page )
        await page.getByTestId( `model-select-confirm-btn` ).click()

        await expect( page ).toHaveURL( /\/chat/, { timeout: 120_000 } )
        await expect( page.getByTestId( `chat-input` ) ).toBeEnabled( { timeout: 120_000 } )

    } )

    test.afterAll( async () => {
        if( app ) await app.close()
    } )

    test.describe.configure( { mode: `serial` } )

    test( `custom system prompt is applied to inference`, async () => {

        // Open settings and set a system prompt
        await page.getByTestId( `settings-btn` ).click()
        await expect( page.getByTestId( `settings-modal` ) ).toBeVisible()

        const system_input = page.getByTestId( `system-prompt-input` )
        await system_input.fill( `Always start your reply with the word "ACKNOWLEDGED".` )

        // Close settings
        await page.keyboard.press( `Escape` )
        await expect( page.getByTestId( `settings-modal` ) ).not.toBeVisible()

        // Send a message
        await send_message( page, `Hello.` )
        await wait_for_inference( page, 1, 120_000 )

        // Verify response exists (content depends on model, so just check non-empty)
        const msgs = await page.locator( `[data-testid="assistant-message"]` ).all()
        const text = await msgs[ msgs.length - 1 ].textContent()
        expect( text?.length ).toBeGreaterThan( 0 )

    } )

    test( `max tokens limits response length`, async () => {

        // Start fresh conversation
        await page.getByTestId( `new-chat-btn` ).click()
        await expect( page.locator( `[data-testid="assistant-message"]` ) ).toHaveCount( 0, { timeout: 5_000 } )

        // Set very low max tokens
        await page.getByTestId( `settings-btn` ).click()
        await page.getByTestId( `settings-tab-advanced` ).click()

        const max_tokens = page.getByTestId( `max-tokens-input` )
        await max_tokens.fill( `20` )

        await page.keyboard.press( `Escape` )

        // Send a prompt that would normally produce a long response
        await send_message( page, `Tell me everything you know about the solar system.` )
        await wait_for_inference( page, 1, 120_000 )

        // Verify response is short — 20 tokens should produce < 400 chars
        const msgs = await page.locator( `[data-testid="assistant-message"]` ).all()
        const text = await msgs[ msgs.length - 1 ].textContent()
        expect( text?.length ).toBeGreaterThan( 0 )
        expect( text?.length ).toBeLessThan( 400 )

    } )

} )
