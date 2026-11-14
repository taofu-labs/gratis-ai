import { test, expect } from '@playwright/test'
import fs from 'fs'
import { MODELS, TEST_PROMPT } from '../fixtures/test_models'
import { launch_electron, preload_model, send_message, start_with_installed_model, use_installed_model } from '../helpers/electron_helpers'
import { wait_for_inference } from '../helpers/wait_for_inference'

// Tests model switching in Electron:
// Pre-cache two models → load first → chat → switch to second → chat → verify both respond.

const CACHE_DIR = `/tmp/gratisai-test-models`
const has_cache = fs.existsSync( CACHE_DIR )

const MODEL_A = MODELS.smollm2
const MODEL_B = MODELS.tinyllama

let app
let page

test.describe( `Electron Model Switching`, () => {

    test.setTimeout( 600_000 )
    test.skip( !has_cache, `No model cache at ${ CACHE_DIR }. Run scripts/download_test_models.sh first.` )

    test.beforeAll( async () => {

        const result = await launch_electron()
        app = result.app
        page = result.page

        // Pre-load both models
        await preload_model( app, MODEL_A, CACHE_DIR )
        await preload_model( app, MODEL_B, CACHE_DIR )

    } )

    test.afterAll( async () => {
        if( app ) await app.close()
    } )

    test.describe.configure( { mode: `serial` } )

    test( `loads first model and produces inference`, async () => {

        // Onboarding into a chat with model A
        await start_with_installed_model( page, MODEL_A )

        // Send test prompt
        await send_message( page, TEST_PROMPT )
        await wait_for_inference( page, 1, 120_000 )

        // Verify response
        const msgs = await page.locator( `[data-testid="assistant-message"]` ).all()
        expect( msgs.length ).toBeGreaterThanOrEqual( 1 )

    } )

    test( `switches to second model and produces inference`, async () => {

        // Use model selector dropdown to switch to model B
        const dropdown = page.getByTestId( `model-selector-dropdown` )

        if( await dropdown.isVisible( { timeout: 5_000 } ).catch( () => false ) ) {

            await dropdown.click()

            // Select model B
            const option_b = page.locator( `button`, { hasText: MODEL_B.name } )
            await expect( option_b ).toBeVisible( { timeout: 5_000 } )
            await option_b.click()

            // Wait for model switch: the selector names the model that is loaded
            await expect( dropdown ).toContainText( MODEL_B.name, { timeout: 120_000 } )
            await expect( page.getByTestId( `chat-input` ) ).toBeEnabled( { timeout: 120_000 } )

        } else {

            // Fallback: navigate back to onboarding to switch models
            await page.goto( `/` )
            await expect( page.getByTestId( `get-started-btn` ) ).toBeEnabled( { timeout: 15_000 } )
            await page.getByTestId( `get-started-btn` ).click()

            await use_installed_model( page, MODEL_B )

        }

        // Send test prompt with model B
        await send_message( page, TEST_PROMPT )
        await wait_for_inference( page, 1, 120_000 )

        // Verify response
        const msgs = await page.locator( `[data-testid="assistant-message"]` ).all()
        expect( msgs.length ).toBeGreaterThanOrEqual( 1 )

    } )

} )
