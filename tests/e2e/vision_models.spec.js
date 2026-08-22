import { test, expect } from '@playwright/test'

// Helper: inject high-memory overrides before the page loads.
// Headless Chromium often reports low deviceMemory (~2 GB) and a tight
// jsHeapSizeLimit, which drives estimate_max_model_bytes below the
// ~2 GB threshold needed for vision models. We override both APIs
// so the memory budget is large enough to surface the vision card.
const inject_high_memory = async ( page ) => {
    await page.addInitScript( () => {
        Object.defineProperty( navigator, `deviceMemory`, { get: () => 8, configurable: true } )
        if( typeof performance !== `undefined` ) {
            Object.defineProperty( performance, `memory`, {
                get: () => ( {
                    jsHeapSizeLimit: 8_589_934_592,
                    totalJSHeapSize: 50_000_000,
                    usedJSHeapSize: 30_000_000,
                } ),
                configurable: true,
            } )
        }
    } )
}

test.describe( `Vision Models — Model Select Page`, () => {

    test( `model select page loads and shows Pick a model`, async ( { page } ) => {
        await page.goto( `/select-model` )
        await expect( page.getByText( `Pick a model` ) ).toBeVisible()
    } )

    test( `vision card appears when device has enough memory`, async ( { page } ) => {

        await inject_high_memory( page )
        await page.goto( `/select-model` )

        // The vision card label should be visible
        const label = page.getByRole( `heading`, { name: `Handles Files` } )
        await expect( label ).toBeVisible( { timeout: 10_000 } )
    } )

    test( `vision card is clickable and selectable`, async ( { page } ) => {

        await inject_high_memory( page )
        await page.goto( `/select-model` )

        // Find and click the vision card button
        const vision_btn = page.getByRole( `button`, { name: /Handles Files/i } )
        await expect( vision_btn ).toBeVisible( { timeout: 10_000 } )
        await vision_btn.click()

        // The download button should still be visible (card was selected)
        await expect( page.getByTestId( `model-select-confirm-btn` ) ).toBeVisible()
    } )

    test( `vision tag appears in alternatives list`, async ( { page } ) => {

        await inject_high_memory( page )
        await page.goto( `/select-model` )

        // Expand alternatives
        const toggle = page.getByTestId( `change-model-toggle` )
        await expect( toggle ).toBeVisible( { timeout: 10_000 } )
        await toggle.click()

        // Look for "vision" tag text in the expanded list
        await expect( page.getByText( `vision` ).first() ).toBeVisible( { timeout: 5_000 } )
    } )

    test( `download button navigates after selecting vision card`, async ( { page } ) => {

        await inject_high_memory( page )
        await page.goto( `/select-model` )

        // Select the vision card
        const vision_btn = page.getByRole( `button`, { name: /Handles Files/i } )
        await expect( vision_btn ).toBeVisible( { timeout: 10_000 } )
        await vision_btn.click()

        // Click the download/start button
        const download_btn = page.getByTestId( `model-select-confirm-btn` )
        await expect( download_btn ).toBeVisible()
        await download_btn.click()

        // Should navigate to the download page
        await expect( page ).toHaveURL( /\/download/ )
    } )

    test( `vision card does not appear when memory is too low`, async ( { page } ) => {

        // Override navigator.deviceMemory to simulate a low-memory device
        await page.addInitScript( () => {
            Object.defineProperty( navigator, `deviceMemory`, { get: () => 1, configurable: true } )
        } )

        await page.goto( `/select-model` )

        // Wait for page to fully render
        await expect( page.getByText( `Pick a model` ) ).toBeVisible()
        await expect( page.getByTestId( `model-select-confirm-btn` ) ).toBeVisible()
        await expect( page.getByTestId( `model-select-confirm-btn` ) ).toBeDisabled()
        await expect( page.getByTestId( `no-fitting-local-model` ) ).toBeVisible()

        // Vision card should NOT appear
        await expect( page.getByText( `Handles Files` ) ).not.toBeVisible()
    } )

} )
