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
    await expect( page.getByRole( `heading`, { name: `gratisAI` } ) ).toBeVisible()
    const get_started = page.getByTestId( `get-started-btn` )
    if( await get_started.isVisible() ) {
        await expect( get_started ).toBeEnabled( { timeout: 15_000 } )
        await get_started.click()
    } else {
        // Returning users land on HomePage with their active model already
        // loaded. Follow its real switch-model action into the picker.
        const switch_model = page.getByTestId( `home-switch-model` ).filter( { visible: true } )
        await expect( switch_model ).toBeVisible( { timeout: load_timeout } )
        await switch_model.click()
    }

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

    const option = page.getByTestId( `model-option-${ model.id }` )
    if( await option.isVisible() ) {
        if( await option.getAttribute( `role` ) === `button` ) await option.click()
        return
    }

    // The model is in the collapsed alternatives list.
    const toggle = page.getByTestId( `change-model-toggle` )
    await expect( toggle ).toBeVisible( { timeout: 5_000 } )
    await toggle.click()

    await expect( option ).toBeVisible( { timeout: 5_000 } )
    await option.click()

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
    const dropdown = page.getByTestId( `model-selector-dropdown` ).filter( { visible: true } )
    await dropdown.click()

    // Click the model option
    const option = dropdown.locator( `..` )
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

    const user_messages = page.getByTestId( `user-message` )
    const previous_count = await user_messages.count()

    await page.getByTestId( `chat-input` ).fill( message )
    await page.getByTestId( `send-btn` ).click()
    await expect( user_messages ).toHaveCount( previous_count + 1 )

}
