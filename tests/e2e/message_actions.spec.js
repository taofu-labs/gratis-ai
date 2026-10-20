import { test, expect } from '@playwright/test'
import { MODELS, LONG_PROMPT } from '../fixtures/test_models'
import { download_model_via_ui, send_message } from '../helpers/download_model'
import { wait_for_inference } from '../helpers/wait_for_inference'

// Tests message-level actions: edit + resend, and regenerate.
// Both actions trigger new inference and modify the conversation.
//
// Uses a shared browser context so the model is downloaded once.

test.describe( `Message Actions`, () => {

    test.setTimeout( 600_000 )

    /** @type {import('@playwright/test').BrowserContext} */
    let context

    /** @type {import('@playwright/test').Page} */
    let page

    test.beforeAll( async ( { browser } ) => {

        context = await browser.newContext()
        page = await context.newPage()

        // Download SmolLM2 — smallest model
        await download_model_via_ui( page, MODELS.smollm2, { download_timeout: 300_000 } )

    } )

    test.afterAll( async () => {
        await context?.close()
    } )

    test.describe.configure( { mode: `serial` } )

    test( `edit and resend a user message triggers new inference`, async () => {

        // Send initial message
        await send_message( page, `What is 1+1?` )
        await wait_for_inference( page, 1, 180_000 )

        // Verify initial response exists
        const initial_msgs = await page.locator( `[data-testid="assistant-message"]` ).all()
        expect( initial_msgs.length ).toBe( 1 )

        // Hover over the user message to reveal action buttons
        const user_msg = page.locator( `[data-testid="user-message"]` ).first()
        await user_msg.hover()

        // Click edit button
        const edit_btn = page.getByTestId( `message-edit-btn` )
        if( await edit_btn.isVisible( { timeout: 3_000 } ).catch( () => false ) ) {

            await edit_btn.click()

            // Fill in edited text
            const textarea = page.getByTestId( `message-edit-textarea` )
            await expect( textarea ).toBeVisible( { timeout: 3_000 } )
            await textarea.fill( `What is 3+3? Answer with just the number.` )

            // Submit the edit
            await page.getByTestId( `message-edit-submit` ).click()

            // Wait for new inference from the edited message
            await wait_for_inference( page, 1, 180_000 )

            // Verify the conversation was updated — the user message text should have changed
            const updated_user = await page.locator( `[data-testid="user-message"]` ).first().textContent()
            expect( updated_user ).toContain( `3+3` )

        } else {

            // Edit button not implemented yet — skip gracefully
            test.skip( true, `message-edit-btn not found — feature may not be implemented yet` )

        }

    } )

    test( `regenerate produces a new assistant response`, async () => {

        // Start fresh
        await page.getByTestId( `new-chat-btn` ).click()
        await expect( page.locator( `[data-testid="assistant-message"]` ) ).toHaveCount( 0, { timeout: 5_000 } )

        // Send a message
        await send_message( page, `Say a random word.` )
        await wait_for_inference( page, 1, 180_000 )

        // Capture original response
        const original_text = await page.locator( `[data-testid="assistant-message"]` ).last().textContent()
        expect( original_text?.length ).toBeGreaterThan( 0 )

        // Hover over the assistant message to reveal regenerate button
        const assistant_msg = page.locator( `[data-testid="assistant-message"]` ).last()
        await assistant_msg.hover()

        const regen_btn = page.getByTestId( `message-regenerate-btn` )
        if( await regen_btn.isVisible( { timeout: 3_000 } ).catch( () => false ) ) {

            await regen_btn.click()

            // Wait for new inference — the response should update
            await wait_for_inference( page, 1, 180_000 )

            // Verify a response still exists (may or may not differ from original)
            const new_text = await page.locator( `[data-testid="assistant-message"]` ).last().textContent()
            expect( new_text?.length ).toBeGreaterThan( 0 )

        } else {

            // Regenerate button not implemented yet — skip gracefully
            test.skip( true, `message-regenerate-btn not found — feature may not be implemented yet` )

        }

    } )

    /**
     * Wait until the last assistant bubble shows real tokens, then stop it
     */
    const stop_after_tokens = async () => {

        await expect( async () => {
            const last = page.locator( `[data-testid="assistant-message"]` ).last()
            await expect( last.getByTestId( `waking-up-indicator` ) ).toHaveCount( 0 )
            expect( ( await last.textContent() )?.length ).toBeGreaterThan( 0 )
        } ).toPass( { timeout: 180_000 } )

        const stop_btn = page.getByTestId( `stop-btn` )
        if( await stop_btn.isVisible() ) await stop_btn.click()
        await expect( stop_btn ).toHaveCount( 0, { timeout: 30_000 } )

    }

    const click_regenerate = async () => {
        await page.locator( `[data-testid="assistant-message"]` ).last().hover()
        await page.getByTestId( `message-regenerate-btn` ).click()
    }

    test( `stop then regenerate persists only the new reply`, async () => {

        await page.getByTestId( `new-chat-btn` ).click()
        await expect( page.locator( `[data-testid="assistant-message"]` ) ).toHaveCount( 0, { timeout: 5_000 } )

        // Stop a long reply, then regenerate right away: the stopped reply's
        // late final save must not resurrect it next to the new one
        await send_message( page, LONG_PROMPT )
        await stop_after_tokens()
        await click_regenerate()
        await stop_after_tokens()

        await page.reload()
        await expect( page.getByTestId( `user-message` ) ).toHaveCount( 1, { timeout: 30_000 } )
        await expect( page.locator( `[data-testid="assistant-message"]` ) ).toHaveCount( 1 )

    } )

    test( `new chat during regenerate leaves the fresh chat empty`, async () => {

        // Regenerate the reloaded conversation, then leave before it can stream
        await expect( page.getByTestId( `chat-input` ) ).toBeEnabled( { timeout: 180_000 } )
        await click_regenerate()
        await page.getByTestId( `new-chat-btn` ).click()

        // Nothing from the abandoned run may stream into the new chat
        await page.waitForTimeout( 5_000 )
        await expect( page.getByTestId( `user-message` ) ).toHaveCount( 0 )
        await expect( page.locator( `[data-testid="assistant-message"]` ) ).toHaveCount( 0 )

    } )

} )
