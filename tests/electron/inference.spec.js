import { test, expect } from '@playwright/test'
import { MODELS, TEST_PROMPT, LONG_PROMPT } from '../fixtures/test_models'
import { launch_electron, preload_model, send_message } from '../helpers/electron_helpers'
import { wait_for_inference } from '../helpers/wait_for_inference'

// Full Electron inference test: onboarding → model load → chat → inference.
// Uses native node-llama-cpp through the Electron IPC bridge.

let app
let page

test.describe( `Electron Inference`, () => {

    test.setTimeout( 600_000 )

    test.beforeAll( async () => {

        const result = await launch_electron()
        app = result.app
        page = result.page

    } )

    test.afterAll( async () => {
        if( app ) await app.close()
    } )

    test( `full onboarding → download → chat → inference flow`, async () => {

        // Welcome page should load
        await expect( page.getByRole( `heading`, { name: `gratisAI` } ) ).toBeVisible( { timeout: 15_000 } )

        // Wait for device detection
        await expect( page.getByTestId( `get-started-btn` ) ).toBeEnabled( { timeout: 15_000 } )
        await page.getByTestId( `get-started-btn` ).click()

        // Model select — confirm the auto-recommended model
        await expect( page ).toHaveURL( /\/select-model/ )
        await expect( page.getByText( `Pick a model` ) ).toBeVisible()
        await page.getByTestId( `model-select-confirm-btn` ).click()

        // Download — wait for it to complete (Electron downloads to filesystem)
        await expect( page ).toHaveURL( /\/download/ )
        await expect( page ).toHaveURL( /\/chat/, { timeout: 300_000 } )

        // Chat should be ready
        await expect( page.getByTestId( `chat-input` ) ).toBeEnabled( { timeout: 120_000 } )

        // Send test prompt
        await send_message( page, TEST_PROMPT )

        // Wait for native inference response
        await wait_for_inference( page, 1, 120_000 )

        // Verify response content
        const messages = await page.locator( `[data-testid="assistant-message"]` ).all()
        const text = await messages[ messages.length - 1 ].textContent()
        expect( text?.length ).toBeGreaterThan( 0 )

        // Verify generation stats
        await expect( page.getByTestId( `generation-stats` ) ).toBeVisible( { timeout: 30_000 } )

    } )

    test( `abort works during native inference`, async () => {

        // Assumes model is already loaded from previous test
        await send_message( page, LONG_PROMPT )

        // Wait for streaming to begin
        await expect( page.locator( `[data-testid="assistant-message"]` ).last() ).toBeVisible( { timeout: 60_000 } )
        await page.waitForTimeout( 2_000 )

        // Click stop if visible
        const stop_btn = page.getByTestId( `stop-btn` )
        if( await stop_btn.isVisible() ) {
            await stop_btn.click()
        }

        // Should be able to send another message
        await expect( page.getByTestId( `chat-input` ) ).toBeEnabled( { timeout: 30_000 } )

    } )

} )
