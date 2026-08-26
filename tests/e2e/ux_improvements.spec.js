import { test, expect } from '@playwright/test'

const TPN_MODEL_FILE = `Qwen3.5-4B-Q4_K_M.gguf`
const TPN_MODEL_ID = `tpn-001-winner-qwen3-5-4b-q4-k-m`

const mock_tpn_winners = async page => {

    await page.route( /\/api\/collections\?owner=tpnlabs&limit=50$/, route => route.fulfill( {
        contentType: `application/json`,
        json: [ {
            title: `TPN-001`,
            slug: `tpnlabs/tpn-001`,
            shareUrl: `https://huggingface.co/collections/tpnlabs/tpn-001`,
            items: [ {
                type: `model`,
                id: `tpnlabs/tpn-001-winner`,
                author: `winner`,
                numParameters: 4_000_000_000,
                note: { text: `winner` },
            } ],
        } ],
    } ) )

    await page.route( /\/api\/models\/tpnlabs\/tpn-001-winner\?blobs=false$/, route => route.fulfill( {
        contentType: `application/json`,
        json: {
            numParameters: 4_000_000_000,
            gguf: {
                architecture: `qwen3`,
                context_length: 4096,
            },
            cardData: {
                license: `apache-2.0`,
            },
            siblings: [ {
                rfilename: TPN_MODEL_FILE,
                size: 420_000_000,
            } ],
        },
    } ) )

}

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

    test( `get app page shows in-progress desktop copy`, async ( { page } ) => {
        await page.goto( `/get-app` )

        await expect( page.getByRole( `heading`, { name: `Desktop app in the works` } ) ).toBeVisible()
        await expect( page.getByText( /desktop builds are being prepared/i ) ).toBeVisible()
        await expect( page.getByText( `Continue in your browser` ) ).toBeVisible()
        await expect( page.getByText( `Get more power with the same privacy — try the desktop app` ) ).toHaveCount( 0 )
        await expect( page.locator( `body` ) ).not.toContainText( `desktop_in_works_title` )
    } )

    // ── Model Select Page ─────────────────────────────────────────────

    test( `model select shows TPN winner models and custom loader`, async ( { page } ) => {
        await mock_tpn_winners( page )
        await page.goto( `/select-model` )
        await expect( page.getByText( `Pick a model` ) ).toBeVisible()
        await expect( page.getByTestId( `tpn-model-list` ) ).toBeVisible()
        await expect( page.getByTestId( `model-option-${ TPN_MODEL_ID }` ) ).toBeVisible()
        await expect( page.getByTestId( `custom-model-input` ) ).toBeVisible()
        await expect( page.getByTestId( `model-select-confirm-btn` ) ).toBeVisible()
        await expect( page.getByTestId( `model-select-confirm-btn` ) ).toBeDisabled()
    } )

    test( `model select enables continue after choosing a TPN winner`, async ( { page } ) => {
        await mock_tpn_winners( page )
        await page.goto( `/select-model` )
        await page.getByTestId( `model-option-${ TPN_MODEL_ID }` ).click()
        await expect( page.getByTestId( `model-select-confirm-btn` ) ).toBeEnabled()
    } )

    test( `large browser alternatives obey the current device memory budget`, async ( { page } ) => {
        await mock_tpn_winners( page )
        await page.goto( `/select-model` )
        const toggle = page.getByTestId( `change-model-toggle` )
        if( await toggle.isVisible() ) await toggle.click()

        await expect( page.getByTestId( `model-option-qwen35-9b-vision-q4km` ) ).toHaveCount( 0 )
        await expect( page.getByTestId( `model-option-qwen3-14b-q4km` ) ).toHaveCount( 0 )
    } )

    test( `model select shows step progress`, async ( { page } ) => {
        await mock_tpn_winners( page )
        await page.goto( `/select-model` )
        await expect( page.getByTestId( `step-indicator` ) ).toBeVisible()
    } )

    test( `speed probe samples the selected GGUF path with one range`, async ( { page } ) => {
        await mock_tpn_winners( page )
        await page.route( /\/resolve\/main\/Qwen3\.5-4B-Q4_K_M\.gguf$/, route => route.fulfill( {
            status: 206,
            headers: {
                'Access-Control-Allow-Origin': `*`,
                'Content-Type': `application/octet-stream`,
            },
            body: Buffer.alloc( 8 * 1024 ** 2 ),
        } ) )

        const request = page.waitForRequest( request =>
            request.url().includes( `/resolve/main/${ TPN_MODEL_FILE }` ) && !!request.headers().range )

        await page.goto( `/select-model` )
        await page.getByTestId( `model-option-${ TPN_MODEL_ID }` ).click()
        expect( ( await request ).headers().range ).toMatch( /^bytes=0-\d+$/ )
        await expect( page.getByTestId( `model-select-confirm-btn` ) ).toBeEnabled()
        await expect( page.getByText( `Measuring download speed…` ) ).toHaveCount( 0, { timeout: 10_000 } )
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

    test( `settings basic tab is clean (dark-only, no temperature/tokens)`, async ( { page } ) => {
        await page.goto( `/chat` )
        await page.getByTestId( `settings-btn` ).click()

        // Should show friendly labels
        await expect( page.getByText( `Appearance` ) ).toHaveCount( 0 )
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
        await expect( page.getByRole( `heading`, { name: /gratis/i } ) ).toBeVisible()
        await expect( page.getByTestId( `get-started-btn` ) ).toBeVisible()
    } )

    test( `model select page is usable on mobile`, async ( { page } ) => {
        await mock_tpn_winners( page )
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
