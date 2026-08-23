import { test, expect } from '@playwright/test'

test.describe( `Welcome Page`, () => {

    test( `loads and displays app name`, async ( { page } ) => {
        await page.goto( `/` )
        await expect( page.getByRole( `heading`, { name: `gratisAI` } ) ).toBeVisible()
    } )

    test( `shows Get Started button`, async ( { page } ) => {
        await page.goto( `/` )
        await expect( page.getByTestId( `get-started-btn` ) ).toBeVisible()
    } )

    test( `shows value propositions about privacy and offline`, async ( { page } ) => {
        await page.goto( `/` )
        // Privacy value prop
        await expect( page.getByText( /stay on your device/i ) ).toBeVisible()
        // Offline value prop
        await expect( page.getByText( /without internet/i ) ).toBeVisible()
    } )

    test( `hides device details behind toggle (progressive disclosure)`, async ( { page } ) => {
        await page.goto( `/` )
        // Wait for detection to finish
        await expect( page.getByTestId( `get-started-btn` ) ).toBeEnabled( { timeout: 10_000 } )

        // Device details toggle should be visible and say "Show"
        const toggle = page.getByTestId( `device-details-toggle` )
        await expect( toggle ).toBeVisible()
        await expect( toggle ).toContainText( `Show` )

        // Click toggle to expand — label should change to "Hide"
        await toggle.click()
        await expect( toggle ).toContainText( `Hide` )

        // Click again to collapse — label returns to "Show"
        await toggle.click()
        await expect( toggle ).toContainText( `Show` )
    } )

    test( `shows step progress indicator`, async ( { page } ) => {
        await page.goto( `/` )
        await expect( page.getByTestId( `step-indicator` ) ).toBeVisible()
    } )

    test( `navigates to model select on Get Started click`, async ( { page } ) => {
        await page.goto( `/` )
        // Wait for detection to finish (button becomes enabled)
        await expect( page.getByTestId( `get-started-btn` ) ).toBeEnabled( { timeout: 10_000 } )
        await page.getByTestId( `get-started-btn` ).click()
        await expect( page ).toHaveURL( /\/select-model/ )
    } )

    test( `routes work correctly`, async ( { page } ) => {

        // Welcome page
        await page.goto( `/` )
        await expect( page.getByRole( `heading`, { name: `gratisAI` } ) ).toBeVisible()

        // Model select page
        await page.goto( `/select-model` )
        await expect( page.getByText( `Pick a model` ) ).toBeVisible()

        // Download page redirects to model select when no model in state
        await page.goto( `/download` )
        await expect( page ).toHaveURL( /\/select-model/ )

        // Chat page
        await page.goto( `/chat` )
        // Should show the no-model setup CTA
        await expect( page.getByTestId( `setup-model-btn` ) ).toBeVisible()

    } )

} )
