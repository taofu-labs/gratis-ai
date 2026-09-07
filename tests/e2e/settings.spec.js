import { test, expect } from '@playwright/test'

const SETTINGS_EVENT = `gratis:settings-changed`
const HF_TOKEN_KEY = `gratis:settings:hf_token`

test.describe( `Settings Modal`, () => {

    test( `opens settings via gear icon`, async ( { page } ) => {
        await page.goto( `/chat` )
        await page.getByTestId( `settings-btn` ).click()
        await expect( page.getByTestId( `settings-modal` ) ).toBeVisible()
    } )

    test( `shows three tabs`, async ( { page } ) => {
        await page.goto( `/chat` )
        await page.getByTestId( `settings-btn` ).click()
        await expect( page.getByTestId( `settings-tab-basic` ) ).toBeVisible()
        await expect( page.getByTestId( `settings-tab-advanced` ) ).toBeVisible()
        await expect( page.getByTestId( `settings-tab-models` ) ).toBeVisible()
    } )

    test( `basic tab shows system prompt (renamed to Custom Instructions)`, async ( { page } ) => {
        await page.goto( `/chat` )
        await page.getByTestId( `settings-btn` ).click()
        await expect( page.getByTestId( `system-prompt-input` ) ).toBeVisible()
    } )

    test( `basic tab does NOT show temperature slider (moved to advanced)`, async ( { page } ) => {
        await page.goto( `/chat` )
        await page.getByTestId( `settings-btn` ).click()
        // Temperature slider should not be visible in basic tab
        await expect( page.getByTestId( `temperature-slider` ) ).not.toBeVisible()
    } )

    test( `advanced tab shows temperature slider (Creativity)`, async ( { page } ) => {
        await page.goto( `/chat` )
        await page.getByTestId( `settings-btn` ).click()
        await page.getByTestId( `settings-tab-advanced` ).click()
        await expect( page.getByTestId( `temperature-slider` ) ).toBeVisible()
        // Should use friendly label "Creativity" instead of "Temperature"
        await expect( page.getByText( `Creativity` ) ).toBeVisible()
    } )

    test( `advanced tab shows response length (max tokens)`, async ( { page } ) => {
        await page.goto( `/chat` )
        await page.getByTestId( `settings-btn` ).click()
        await page.getByTestId( `settings-tab-advanced` ).click()
        await expect( page.getByTestId( `max-tokens-input` ) ).toBeVisible()
        // Should use friendly label "Response Length"
        await expect( page.getByText( `Response Length` ) ).toBeVisible()
    } )

    test( `closes settings on escape key`, async ( { page } ) => {
        await page.goto( `/chat` )
        await page.getByTestId( `settings-btn` ).click()
        await expect( page.getByTestId( `settings-modal` ) ).toBeVisible()
        await page.keyboard.press( `Escape` )
        await expect( page.getByTestId( `settings-modal` ) ).not.toBeVisible()
    } )

    test( `switching tabs shows different content`, async ( { page } ) => {
        await page.goto( `/chat` )
        await page.getByTestId( `settings-btn` ).click()

        // Click Advanced tab
        await page.getByTestId( `settings-tab-advanced` ).click()
        await expect( page.getByText( `Top P` ) ).toBeVisible()

        // Click Models tab
        await page.getByTestId( `settings-tab-models` ).click()
        await expect( page.getByTestId( `add-model-preset-btn` ) ).toBeVisible()
    } )

    test( `models tab shows add model preset button`, async ( { page } ) => {
        await page.goto( `/chat` )
        await page.getByTestId( `settings-btn` ).click()
        await page.getByTestId( `settings-tab-models` ).click()
        await expect( page.getByTestId( `add-model-preset-btn` ) ).toBeVisible()
    } )

    test( `models tab stores an optional Hugging Face token locally`, async ( { page } ) => {
        await page.goto( `/chat` )
        await page.evaluate( event_name => {
            window.__settings_events = []
            window.addEventListener( event_name, e => window.__settings_events.push( e.detail ) )
        }, SETTINGS_EVENT )
        await page.getByTestId( `settings-btn` ).click()
        await page.getByTestId( `settings-tab-models` ).click()

        const input = page.getByTestId( `hf-token-input` )
        await expect( input ).toHaveAttribute( `type`, `password` )
        await input.fill( `hf_test_token` )
        await expect( page.getByText( `Read token saved locally.` ) ).toBeVisible()

        await page.getByTestId( `hf-token-visibility-btn` ).click()
        await expect( input ).toHaveAttribute( `type`, `text` )

        expect( await page.evaluate( key =>
            localStorage.getItem( key ), HF_TOKEN_KEY
        ) ).toBe( `hf_test_token` )
        const event = await page.evaluate( () => window.__settings_events.at( -1 ) )
        expect( event.key ).toBe( `hf_token` )
        expect( event.sensitive ).toBe( true )
        expect( event.value ).toBeUndefined()

        await page.getByTestId( `hf-token-clear-btn` ).click()
        await expect( page.getByText( `Public downloads will continue without a token.` ) ).toBeVisible()
        expect( await page.evaluate( key =>
            localStorage.getItem( key ), HF_TOKEN_KEY
        ) ).toBe( `` )
    } )

    test( `models tab hides danger zone behind toggle`, async ( { page } ) => {
        await page.goto( `/chat` )
        await page.getByTestId( `settings-btn` ).click()
        await page.getByTestId( `settings-tab-models` ).click()

        // Clear all data button should not be visible initially
        await expect( page.getByTestId( `clear-all-data-btn` ) ).not.toBeVisible()

        // Click danger zone toggle to reveal
        await page.getByTestId( `danger-zone-toggle` ).click()

        // Now the clear all data button should be visible
        await expect( page.getByTestId( `clear-all-data-btn` ) ).toBeVisible()
    } )

    // ── Keyboard shortcuts ─────────────────────────────────────────────

    test( `Ctrl+, keyboard shortcut opens settings modal`, async ( { page } ) => {
        await page.goto( `/chat` )

        // Wait for page to be fully loaded so keyboard shortcut handlers are registered
        await expect( page.getByTestId( `send-btn` ) ).toBeVisible( { timeout: 5_000 } )

        // Ensure settings is closed
        await expect( page.getByTestId( `settings-modal` ) ).not.toBeVisible()

        // Press Ctrl+,
        await page.keyboard.press( `Control+,` )
        await expect( page.getByTestId( `settings-modal` ) ).toBeVisible( { timeout: 3_000 } )
    } )

    test( `Ctrl+N keyboard shortcut creates new chat`, async ( { page } ) => {
        await page.goto( `/chat` )

        // Wait for page to stabilise
        await expect( page.getByTestId( `send-btn` ) ).toBeVisible( { timeout: 5_000 } )

        // Press Ctrl+N — should trigger new chat
        const new_chat_btn = page.getByTestId( `new-chat-btn` )
        if( await new_chat_btn.isVisible( { timeout: 3_000 } ).catch( () => false ) ) {
            await page.keyboard.press( `Control+n` )
            // Verify no assistant messages (fresh state)
            await expect( page.locator( `[data-testid="assistant-message"]` ) ).toHaveCount( 0, { timeout: 5_000 } )
        }
    } )

} )
