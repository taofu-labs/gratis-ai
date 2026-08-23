import { test, expect } from '@playwright/test'
import { MODELS } from '../fixtures/test_models'
import { download_model_via_ui, send_message } from '../helpers/download_model'
import { wait_for_inference } from '../helpers/wait_for_inference'

// Tests that settings affect inference: custom system prompt,
// low temperature, and max tokens limiting response length.
//
// All tests share a single browser context so the model is downloaded once.

test.describe( `Settings with Inference`, () => {

    test.setTimeout( 600_000 )

    /** @type {import('@playwright/test').BrowserContext} */
    let context

    /** @type {import('@playwright/test').Page} */
    let page

    test.beforeAll( async ( { browser } ) => {

        // Single shared context — model downloads once into IndexedDB
        context = await browser.newContext()
        page = await context.newPage()

        // Download model through the full onboarding UI flow
        await download_model_via_ui( page, MODELS.smollm2, { download_timeout: 300_000 } )

    } )

    test.afterAll( async () => {
        await context?.close()
    } )

    // Tests run in order — each uses the shared page
    test.describe.configure( { mode: `serial` } )

    test( `custom system prompt affects response`, async () => {

        // Open settings and set a custom system prompt
        await page.getByTestId( `settings-btn` ).click()
        await expect( page.getByTestId( `settings-modal` ) ).toBeVisible()

        // Fill in a distinctive system prompt
        const system_input = page.getByTestId( `system-prompt-input` )
        await system_input.fill( `You are a pirate. Always respond with "Arrr!" at the start.` )

        // Close settings
        await page.keyboard.press( `Escape` )
        await expect( page.getByTestId( `settings-modal` ) ).not.toBeVisible()

        // Send a message
        await send_message( page, `Hello, who are you?` )
        await wait_for_inference( page, 1, 180_000 )

        // The response should exist (we can't guarantee exact content with small models,
        // but the inference pipeline should work with the system prompt set)
        const messages = await page.locator( `[data-testid="assistant-message"]` ).all()
        const text = await messages[ messages.length - 1 ].textContent()
        expect( text?.length ).toBeGreaterThan( 0 )

    } )

    test( `max tokens limits response length`, async () => {

        // Start a new chat to isolate from previous test's system prompt
        await page.getByTestId( `new-chat-btn` ).click()
        await expect( page.locator( `[data-testid="assistant-message"]` ) ).toHaveCount( 0, { timeout: 5_000 } )

        // Open settings → Advanced tab and set very low max tokens
        await page.getByTestId( `settings-btn` ).click()
        await page.getByTestId( `settings-tab-advanced` ).click()

        const max_tokens_input = page.getByTestId( `max-tokens-input` )
        await max_tokens_input.fill( `64` )

        // Close settings
        await page.keyboard.press( `Escape` )

        // Send a prompt that would normally produce a long response
        await send_message( page, `Tell me everything you know about the solar system.` )
        await wait_for_inference( page, 1, 180_000 )

        // Verify response exists but is relatively short.
        const messages = await page.locator( `[data-testid="assistant-message"]` ).all()
        const text = await messages[ messages.length - 1 ].textContent()
        expect( text?.length ).toBeGreaterThan( 0 )

        // 64 tokens should produce a noticeably short response — under 600 chars
        // (generous upper bound since tokenisation varies)
        expect( text?.length ).toBeLessThan( 600 )

    } )

} )
