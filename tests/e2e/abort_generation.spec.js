import { test, expect } from '@playwright/test'
import { MODELS, LONG_PROMPT } from '../fixtures/test_models'
import { download_model_via_ui, send_message } from '../helpers/download_model'

// Tests aborting generation mid-stream.
// Sends a long prompt, waits for streaming to begin, clicks stop,
// and verifies partial response is preserved and new messages can be sent.

test.describe( `Abort Generation`, () => {

    test.setTimeout( 600_000 )

    test( `abort mid-generation preserves partial response`, async ( { page } ) => {

        // Download SmolLM2 (smallest model for fast setup)
        await download_model_via_ui( page, MODELS.smollm2, { download_timeout: 300_000 } )

        // Send a long prompt that will generate a lengthy response
        await send_message( page, LONG_PROMPT )

        // Wait for real tokens: the prompt-reading indicator also renders text
        // inside the bubble, and stopping during it rightly keeps no partial text
        await expect( async () => {
            const msgs = await page.locator( `[data-testid="assistant-message"]` ).all()
            expect( msgs.length ).toBeGreaterThanOrEqual( 1 )
            const last = msgs[ msgs.length - 1 ]
            await expect( last.getByTestId( `waking-up-indicator` ) ).toHaveCount( 0 )
            const content = await last.textContent()
            expect( content?.length ).toBeGreaterThan( 0 )
        } ).toPass( { timeout: 180_000 } )

        // Try to abort — if the stop button is still visible, click it.
        // SmolLM2 is fast enough that generation may already be done.
        const stop_btn = page.getByTestId( `stop-btn` )
        const stop_was_visible = await stop_btn.isVisible()
        if( stop_was_visible ) {
            await stop_btn.click()
            await page.waitForTimeout( 1_000 )
        }

        // Verify response text is preserved regardless of whether we aborted or it finished
        const messages = await page.locator( `[data-testid="assistant-message"]` ).all()
        expect( messages.length ).toBeGreaterThanOrEqual( 1 )
        const text = await messages[ messages.length - 1 ].textContent()
        expect( text?.length ).toBeGreaterThan( 0 )

        // Verify we can send a new message after aborting
        await expect( page.getByTestId( `chat-input` ) ).toBeEnabled( { timeout: 30_000 } )
        await send_message( page, `Say hi.` )

        // Wait for the new response
        await expect( async () => {
            const all_msgs = await page.locator( `[data-testid="assistant-message"]` ).all()
            expect( all_msgs.length ).toBeGreaterThanOrEqual( 2 )
        } ).toPass( { timeout: 180_000 } )

    } )

} )
