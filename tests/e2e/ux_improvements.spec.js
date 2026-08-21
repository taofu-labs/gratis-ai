import { test, expect } from '@playwright/test'

test.describe( `UX Improvements - Progressive Disclosure`, () => {

    // ── Welcome Page ──────────────────────────────────────────────────

    test( `welcome page shows warm, non-technical messaging`, async ( { page } ) => {
        await page.goto( `/` )
        // Should describe the app in simple terms
        await expect( page.getByText( /AI assistant/i ) ).toBeVisible()
        await expect( page.getByText( /private/i ) ).toBeVisible()
    } )

    test( `welcome page hides technical device info by default`, async ( { page } ) => {
        await page.goto( `/` )
        await expect( page.getByTestId( `get-started-btn` ) ).toBeEnabled( { timeout: 10_000 } )

        // Device details should be collapsed
        const toggle = page.getByTestId( `device-details-toggle` )
        await expect( toggle ).toBeVisible()

        // Toggle text should say "Show device details"
        await expect( toggle ).toContainText( `Show` )

        // Open it
        await toggle.click()
        await expect( toggle ).toContainText( `Hide` )
    } )

    // ── Model Select Page ─────────────────────────────────────────────

    test( `model select auto-recommends a model`, async ( { page } ) => {
        await page.goto( `/select-model` )
        await expect( page.getByText( `Pick a model` ) ).toBeVisible()
        // Should have a confirm button
        await expect( page.getByTestId( `model-select-confirm-btn` ) ).toBeVisible()
    } )

    test( `model select hides alternatives behind toggle`, async ( { page } ) => {
        await page.goto( `/select-model` )
        const toggle = page.getByTestId( `change-model-toggle` )
        await expect( toggle ).toBeVisible()
        await expect( toggle ).toContainText( `Choose a different local model` )
    } )

    test( `model select shows step progress`, async ( { page } ) => {
        await page.goto( `/select-model` )
        await expect( page.getByTestId( `step-indicator` ) ).toBeVisible()
    } )

    // ── Chat Page ─────────────────────────────────────────────────────

    test( `chat page shows actionable setup CTA instead of dismissive banner`, async ( { page } ) => {
        await page.goto( `/chat` )
        // Should NOT show old "No model loaded" banner text
        await expect( page.getByText( `No model loaded. Go to the welcome page` ) ).not.toBeVisible()
        // Should show new friendly CTA
        await expect( page.getByText( `Let's get you set up` ) ).toBeVisible()
        await expect( page.getByTestId( `setup-model-btn` ) ).toBeVisible()
    } )

    // ── Settings Progressive Disclosure ───────────────────────────────

    test( `settings basic tab is clean (no temperature/tokens)`, async ( { page } ) => {
        await page.goto( `/chat` )
        await page.getByTestId( `settings-btn` ).click()

        // Should show friendly labels
        await expect( page.getByText( `Appearance` ) ).toBeVisible()
        await expect( page.getByText( `Custom Instructions` ) ).toBeVisible()

        // Should NOT show temperature or max tokens (those are advanced now)
        await expect( page.getByText( `Temperature` ) ).not.toBeVisible()
        await expect( page.getByText( `Max Tokens` ) ).not.toBeVisible()
    } )

    test( `settings advanced tab uses friendly labels`, async ( { page } ) => {
        await page.goto( `/chat` )
        await page.getByTestId( `settings-btn` ).click()
        await page.getByTestId( `settings-tab-advanced` ).click()

        // Should use "Creativity" instead of "Temperature"
        await expect( page.getByText( `Creativity` ) ).toBeVisible()
        // Should use "Response Length" instead of "Max Tokens"
        await expect( page.getByText( `Response Length` ) ).toBeVisible()
        // Should have a "Fine-tuning" divider
        await expect( page.getByText( `Fine-tuning` ) ).toBeVisible()
    } )

    test( `models tab has friendly labels and hidden danger zone`, async ( { page } ) => {
        await page.goto( `/chat` )
        await page.getByTestId( `settings-btn` ).click()
        await page.getByTestId( `settings-tab-models` ).click()

        // Should use friendly section title
        await expect( page.getByText( `Your Models` ) ).toBeVisible()
        await expect( page.getByText( `Your Data` ) ).toBeVisible()

        // Danger zone should be collapsed by default
        await expect( page.getByTestId( `clear-all-data-btn` ) ).not.toBeVisible()

        // Should have the toggle
        const danger_toggle = page.getByTestId( `danger-zone-toggle` )
        await expect( danger_toggle ).toBeVisible()

        // Click to expand danger zone
        await danger_toggle.click()
        await expect( page.getByTestId( `clear-all-data-btn` ) ).toBeVisible()
    } )

} )

test.describe( `UX Improvements - Mobile & Touch`, () => {

    test.use( { viewport: { width: 375, height: 667 } } )

    test( `welcome page is usable on mobile`, async ( { page } ) => {
        await page.goto( `/` )
        await expect( page.getByRole( `heading`, { name: `gratisAI` } ) ).toBeVisible()
        await expect( page.getByTestId( `get-started-btn` ) ).toBeVisible()
    } )

    test( `model select page is usable on mobile`, async ( { page } ) => {
        await page.goto( `/select-model` )
        await expect( page.getByText( `Pick a model` ) ).toBeVisible()
        await expect( page.getByTestId( `model-select-confirm-btn` ) ).toBeVisible()
    } )

    test( `settings modal is usable on mobile`, async ( { page } ) => {
        await page.goto( `/chat` )
        await page.getByTestId( `settings-btn` ).click()
        await expect( page.getByTestId( `settings-modal` ) ).toBeVisible()
        // Tabs should be visible
        await expect( page.getByTestId( `settings-tab-basic` ) ).toBeVisible()
        await expect( page.getByTestId( `settings-tab-advanced` ) ).toBeVisible()
    } )

} )
