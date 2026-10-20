import { test, expect } from '@playwright/test'
import { MODELS, TEST_PROMPT } from '../fixtures/test_models'
import { download_model_via_ui, send_message, switch_model } from '../helpers/download_model'
import { wait_for_inference } from '../helpers/wait_for_inference'

// Tests downloading two models and switching between them.
// The first model goes through full onboarding. The second is downloaded
// separately, then switched to via the model selector dropdown.
//
// Uses a shared browser context so IndexedDB persists across tests.

test.describe( `Model Switching`, () => {

    test.setTimeout( 600_000 )

    /** @type {import('@playwright/test').BrowserContext} */
    let context

    /** @type {import('@playwright/test').Page} */
    let page

    test.beforeAll( async ( { browser } ) => {

        context = await browser.newContext()
        page = await context.newPage()

        // Download the first model (SmolLM2 — smallest, fastest)
        await download_model_via_ui( page, MODELS.smollm2, { download_timeout: 300_000 } )

    } )

    test.afterAll( async () => {
        await context?.close()
    } )

    test.describe.configure( { mode: `serial` } )

    test( `inference works with first model`, async () => {

        await send_message( page, `Say hello. Respond with one word.` )
        await wait_for_inference( page, 1, 180_000 )

        const msgs = await page.locator( `[data-testid="assistant-message"]` ).all()
        expect( msgs.length ).toBeGreaterThanOrEqual( 1 )

    } )

    test( `download second model and switch to it`, async () => {

        // Download the second model via full onboarding (navigates back to /)
        await download_model_via_ui( page, MODELS.tinyllama, { download_timeout: 600_000 } )

        // Verify inference with second model
        await send_message( page, TEST_PROMPT )
        await wait_for_inference( page, 1, 180_000 )

        const msgs = await page.locator( `[data-testid="assistant-message"]` ).all()
        expect( msgs.length ).toBeGreaterThanOrEqual( 1 )

    } )

    test( `switch back to first model via dropdown`, async () => {

        // Use model selector dropdown to switch back to SmolLM2
        // This tests the fast-switch path instead of re-downloading
        await switch_model( page, MODELS.smollm2, { load_timeout: 120_000 } )

        // Verify inference still works after switching back
        await send_message( page, TEST_PROMPT )
        await wait_for_inference( page, 1, 180_000 )

        const msgs = await page.locator( `[data-testid="assistant-message"]` ).all()
        expect( msgs.length ).toBeGreaterThanOrEqual( 1 )

        // Verify generation stats
        // The conversation may hold earlier replies with their own stats
        await expect( page.getByTestId( `generation-stats` ).last() ).toBeVisible( { timeout: 30_000 } )

    } )

} )
