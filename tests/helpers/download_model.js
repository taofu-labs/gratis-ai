import { expect } from '@playwright/test'

/**
 * Navigate through the onboarding flow and download a specific model via the UI.
 * Goes: Welcome → Model Select → pick model → Download → Chat.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Object} model - Model fixture from test_models.js
 * @param {Object} [opts]
 * @param {number} [opts.download_timeout] - Max wait for download completion (ms)
 * @param {number} [opts.load_timeout] - Max wait for model to become ready (ms)
 */
export async function download_model_via_ui( page, model, opts = {} ) {

    const { download_timeout = 300_000, load_timeout = 180_000 } = opts

    // Step 1 — Welcome page
    await page.goto( `/` )
    await expect( page.getByRole( `heading`, { name: `Gratis` } ) ).toBeVisible()
    await expect( page.getByTestId( `get-started-btn` ) ).toBeEnabled( { timeout: 15_000 } )
    await page.getByTestId( `get-started-btn` ).click()

    // Step 2 — Model select: expand alternatives, pick the target model
    await expect( page ).toHaveURL( /\/select-model/ )
    await select_model_on_page( page, model )

    // Step 3 — Confirm selection to start download
    await page.getByTestId( `model-select-confirm-btn` ).click()

    // Step 4 — Wait for download to complete and navigate to /chat
    await expect( page ).toHaveURL( /\/download/ )
    await expect( page.getByTestId( `download-progress-bar` ) ).toBeVisible()
    await expect( page ).toHaveURL( /\/chat/, { timeout: download_timeout } )

    // Step 5 — Wait for model to be loaded and chat input to be enabled
    await expect( page.getByTestId( `chat-input` ) ).toBeEnabled( { timeout: load_timeout } )

}

/**
 * Select a specific model on the model select page.
 *
 * The page may show a two-card layout ("Faster Option" / "Smarter Option")
 * or a single-card layout. Model names are inside the card details block,
 * which is collapsed by default. We check the page text content without
 * expanding toggles, then fall back to the alternatives list.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Object} model - Model fixture from test_models.js
 */
export async function select_model_on_page( page, model ) {

    // Wait for the model select page to be fully rendered before inspecting
    await expect( page.getByTestId( `model-select-confirm-btn` ) ).toBeVisible( { timeout: 10_000 } )

    // Strategy 1 — Check if the model name appears in the full page text.
    // The card details are in the DOM even when visually collapsed, so we can
    // read the page text without clicking any toggles.
    const page_text = await page.locator( `body` ).textContent()

    if( page_text?.includes( model.name ) ) {

        // The model is somewhere on the page (likely a recommendation card).
        // Check if it's inside one of the two OptionCards (two-card layout).
        // OptionCards are direct-child buttons of the CardRow.
        const card_buttons = page.locator( `button`, { hasText: model.name } )
        const card_count = await card_buttons.count()

        // Filter to only the recommendation cards (not alternatives, not confirm)
        // by checking they contain "Show details" (a card-specific toggle)
        for( let i = 0; i < card_count; i++ ) {
            const btn = card_buttons.nth( i )
            const inner = await btn.textContent()
            if( inner?.includes( `Show details` ) ) {
                await btn.click()
                return
            }
        }

        // If we're here, the name appeared in a non-button element (RecommendedCard <div>).
        // That means it's the single-card recommendation — already selected, nothing to do.
        return

    }

    // Strategy 2 — Model is not a recommendation. Open alternatives and pick from list.
    const toggle = page.getByTestId( `change-model-toggle` )
    await expect( toggle ).toBeVisible( { timeout: 5_000 } )
    await toggle.click()

    // Alternatives are plain buttons inside the expand panel, each containing the model name
    const alternative = page.locator( `button`, { hasText: model.name } )
    await expect( alternative.first() ).toBeVisible( { timeout: 5_000 } )
    await alternative.first().click()

}

/**
 * Navigate directly to /chat with a model already cached.
 * Skips the download flow by using the model that was already downloaded.
 * Assumes a model is already in the browser's storage.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Object} [opts]
 * @param {number} [opts.load_timeout] - Max wait for model ready (ms)
 */
export async function navigate_to_chat( page, opts = {} ) {

    const { load_timeout = 60_000 } = opts

    await page.goto( `/chat` )
    await expect( page.getByTestId( `chat-input` ) ).toBeEnabled( { timeout: load_timeout } )

}

/**
 * Switch to a different cached model using the model selector dropdown.
 * Assumes the model is already downloaded and cached.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Object} model - Model fixture to switch to
 * @param {Object} [opts]
 * @param {number} [opts.load_timeout] - Max wait for model switch (ms)
 */
export async function switch_model( page, model, opts = {} ) {

    const { load_timeout = 60_000 } = opts

    // Open model selector dropdown
    await page.getByTestId( `model-selector-dropdown` ).click()

    // Click the model option
    const option = page.locator( `[data-testid="model-selector-dropdown"]` )
        .locator( `..` )
        .locator( `button`, { hasText: model.name } )

    await option.click()

    // Wait for the model to load
    await expect( page.getByTestId( `chat-input` ) ).toBeEnabled( { timeout: load_timeout } )

}

/**
 * Send a message in the chat and return the page (for chaining).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} message - Message text to send
 */
export async function send_message( page, message ) {

    await page.getByTestId( `chat-input` ).fill( message )
    await page.getByTestId( `send-btn` ).click()

}
