import { test, expect } from '@playwright/test'
import { MODELS, TEST_PROMPT } from '../fixtures/test_models'
import { download_model_via_ui, send_message } from '../helpers/download_model'
import { wait_for_inference } from '../helpers/wait_for_inference'

// Tests chat history with real inference: conversations appear in sidebar,
// new chat clears messages, switching back restores them, deleting works.
//
// All tests share a single browser context so the model is downloaded once.

test.describe( `Chat History with Inference`, () => {

    test.setTimeout( 600_000 )

    /** @type {import('@playwright/test').BrowserContext} */
    let context

    /** @type {import('@playwright/test').Page} */
    let page

    test.beforeAll( async ( { browser } ) => {

        // Single shared context — model downloads once into IndexedDB, reused by all tests
        context = await browser.newContext()
        page = await context.newPage()

        // Download model through the full onboarding UI flow
        await download_model_via_ui( page, MODELS.smollm2, { download_timeout: 300_000 } )

    } )

    test.afterAll( async () => {
        await context?.close()
    } )

    // Tests must run in order — each builds on the shared page state
    test.describe.configure( { mode: `serial` } )

    test( `conversation appears in sidebar after inference`, async () => {

        // Send a message and wait for response
        await send_message( page, TEST_PROMPT )
        await wait_for_inference( page, 1, 180_000 )

        // The conversation should now appear in the sidebar
        const conversations = page.locator( `[data-testid^="sidebar-conversation-"]` )
        await expect( conversations.first() ).toBeVisible( { timeout: 10_000 } )

    } )

    test( `new chat clears messages, old chat restores them`, async () => {

        // Start a fresh conversation
        await page.getByTestId( `new-chat-btn` ).click()
        await expect( page.getByTestId( `user-message` ) ).toHaveCount( 0, { timeout: 5_000 } )
        await expect( page.locator( `[data-testid="assistant-message"]` ) ).toHaveCount( 0, { timeout: 5_000 } )

        // Send a message and wait for response
        await send_message( page, `Remember the word: pineapple. Repeat it back.` )
        await wait_for_inference( page, 1, 180_000 )

        // Wait for generation stats — indicates full cycle including IndexedDB persist
        await expect( page.getByTestId( `generation-stats` ) ).toBeVisible( { timeout: 30_000 } )
        await page.waitForTimeout( 500 )

        // Verify assistant message exists
        const first_response = await page.locator( `[data-testid="assistant-message"]` ).first().textContent()
        expect( first_response?.length ).toBeGreaterThan( 0 )

        // Click new chat button
        await page.getByTestId( `new-chat-btn` ).click()

        // Messages should be cleared before reading or sending in the new route.
        await expect( page.getByTestId( `user-message` ) ).toHaveCount( 0, { timeout: 5_000 } )
        await expect( page.locator( `[data-testid="assistant-message"]` ) ).toHaveCount( 0, { timeout: 5_000 } )

        // Click on the previous conversation in the sidebar to restore it
        const sidebar_item = page.locator( `[data-testid^="sidebar-conversation-"]` ).first()
        await expect( sidebar_item ).toBeVisible( { timeout: 5_000 } )
        await sidebar_item.click()

        // The old messages should be restored
        await expect( page.locator( `[data-testid="assistant-message"]` ).first() ).toBeVisible( { timeout: 10_000 } )

    } )

    test( `deleting a conversation removes it from sidebar`, async () => {

        // Start fresh — go to a new chat so we have a clean state
        await page.getByTestId( `new-chat-btn` ).click()
        await expect( page.getByTestId( `user-message` ) ).toHaveCount( 0, { timeout: 5_000 } )
        await expect( page.locator( `[data-testid="assistant-message"]` ) ).toHaveCount( 0, { timeout: 5_000 } )

        // Send a message and wait for response
        await send_message( page, TEST_PROMPT )
        await wait_for_inference( page, 1, 180_000 )

        // Wait for generation stats — indicates conversation persisted
        await expect( page.getByTestId( `generation-stats` ) ).toBeVisible( { timeout: 30_000 } )

        // Verify conversation appears in sidebar
        const conversations = page.locator( `[data-testid^="sidebar-conversation-"]` )
        await expect( conversations.first() ).toBeVisible( { timeout: 10_000 } )

        // Get the conversation id from the current (most recent) conversation
        const testid = await conversations.first().getAttribute( `data-testid` )
        const conv_id = testid?.replace( `sidebar-conversation-`, `` )

        // Click the delete button once to show "Delete?" confirmation
        const delete_btn = page.getByTestId( `sidebar-delete-${ conv_id }` )
        await delete_btn.click()

        // Click again to confirm the actual deletion
        await delete_btn.click()

        // Wait briefly for the deletion to process
        await page.waitForTimeout( 1_000 )

        // The conversation count should decrease (other conversations from earlier tests may exist)
        // Just verify the specific conversation we deleted is gone
        await expect( page.locator( `[data-testid="sidebar-conversation-${ conv_id }"]` ) ).toHaveCount( 0, { timeout: 5_000 } )

    } )

} )
