import { test, expect } from '@playwright/test'

const TPN_MODEL_FILE = `Qwen3.5-4B-Q4_K_M.gguf`
const TPN_MODEL_ID = `tpn-001-winner-qwen3-5-4b-q4-k-m`

const mock_tpn_winners = async ( page, { file_size = 420_000_000 } = {} ) => {

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
                size: file_size,
            } ],
        },
    } ) )

}

// Picker detail tests start where a finished wizard lands: the recommendation
const finish_wizard_before = page => page.addInitScript( () => {
    localStorage.setItem( `gratis:settings:model_wizard_answers`, JSON.stringify( { vision: false, fewer_refusals: false } ) )
} )

test.describe( `UX Improvements - Progressive Disclosure`, () => {

    test.beforeEach( async ( { page } ) => finish_wizard_before( page ) )

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

    test( `get app page links to the latest release assets`, async ( { page } ) => {
        await page.goto( `/get-app` )

        await expect( page.getByText( `Download for macOS` ) ).toBeVisible()
        await expect( page.locator( `a[href$="/releases/latest/download/Gratis-mac.dmg"]` ) ).toHaveCount( 1 )
        await expect( page.locator( `a[href$="/releases/latest/download/Gratis-win.exe"]` ) ).toHaveCount( 1 )
        await expect( page.locator( `a[href$="/releases/latest/download/Gratis-linux.AppImage"]` ) ).toHaveCount( 1 )
        await expect( page.locator( `a[href$="/releases/latest/download/Gratis-mac-intel.dmg"]` ) ).toHaveCount( 1 )
        await expect( page.getByText( `Or continue in your browser` ) ).toBeVisible()
        await expect( page.locator( `body` ) ).not.toContainText( `desktop_in_works_title` )
    } )

    // ── Model Select Page ─────────────────────────────────────────────

    test( `a fitting TPN winner is the recommendation, with the catalog one click away`, async ( { page } ) => {
        await mock_tpn_winners( page )
        await page.goto( `/select-model` )
        await expect( page.getByText( `Pick a model` ) ).toBeVisible()
        await expect( page.getByTestId( `model-hero-name` ) ).toContainText( `TPN-001 winner` )
        await expect( page.getByTestId( `model-select-confirm-btn` ) ).toBeEnabled()

        await page.getByTestId( `browse-models-toggle` ).click()
        await expect( page.getByTestId( `tpn-model-list` ) ).toBeVisible()
        await expect( page.getByTestId( `model-option-${ TPN_MODEL_ID }` ) ).toBeVisible()
        await expect( page.getByTestId( `custom-model-input` ) ).toBeVisible()
    } )

    test( `choosing another model replaces the recommendation until reset`, async ( { page } ) => {
        await mock_tpn_winners( page )
        await page.goto( `/select-model` )
        await page.getByTestId( `browse-models-toggle` ).click()
        await page.getByTestId( `model-option-lfm25-1.2b-tpn-q4km` ).click()

        await expect( page.getByTestId( `model-hero-name` ) ).toContainText( `LFM 2.5 1.2B` )
        await expect( page.getByTestId( `model-select-confirm-btn` ) ).toContainText( `Download · 731 MB` )

        await page.getByTestId( `model-hero-reset` ).click()
        await expect( page.getByTestId( `model-hero-name` ) ).toContainText( `TPN-001 winner` )
    } )

    test( `declared RAM raises the Memory64 model budget`, async ( { page } ) => {
        await page.addInitScript( () => {
            Object.defineProperty( navigator, `deviceMemory`, { configurable: true, value: 4 } )
        } )
        await mock_tpn_winners( page, { file_size: 7_200_000_000 } )
        await page.goto( `/select-model` )
        await page.getByTestId( `browse-models-toggle` ).click()

        const winner_row = page.getByTestId( `model-option-${ TPN_MODEL_ID }` )
        await expect( winner_row ).toBeDisabled()
        await expect( winner_row ).toContainText( `Needs about` )
        await expect( page.getByTestId( `browser-ram-budget` ) ).toContainText( `5.6 GB` )

        page.once( `dialog`, dialog => dialog.accept() )
        await page.getByTestId( `model-select-ram-override` ).selectOption( `16` )

        await expect( page.getByTestId( `browser-ram-budget` ) ).toContainText( `11.5 GB` )
        await expect( winner_row ).toBeEnabled()
        await winner_row.click()
        await expect( page.getByTestId( `model-select-confirm-btn` ) ).toBeEnabled()
    } )

    test( `models too large for this device show why`, async ( { page } ) => {
        await page.addInitScript( () => {
            Object.defineProperty( navigator, `deviceMemory`, { configurable: true, value: 4 } )
        } )
        await mock_tpn_winners( page )
        await page.goto( `/select-model` )
        await page.getByTestId( `browse-models-toggle` ).click()
        await expect( page.getByTestId( `model-option-qwen35-9b-tpn-q4km` ) ).toHaveCount( 0 )

        await page.getByTestId( `show-unfit-toggle` ).click()
        await expect( page.getByTestId( `model-option-qwen35-9b-tpn-q4km` ) ).toBeDisabled()
        await expect( page.getByTestId( `model-option-qwen35-9b-tpn-q4km` ) ).toContainText( `Needs about` )
        await expect( page.getByTestId( `model-option-qwen3-14b-q4km` ) ).toHaveCount( 0 )
    } )

    test( `retired models stay installable behind "older models"`, async ( { page } ) => {
        await mock_tpn_winners( page )
        await page.goto( `/select-model` )
        await page.getByTestId( `browse-models-toggle` ).click()

        await expect( page.getByTestId( `model-option-smollm2-360m-q4km` ) ).toHaveCount( 0 )
        await page.getByTestId( `show-retired-toggle` ).click()
        await expect( page.getByTestId( `model-option-smollm2-360m-q4km` ) ).toBeVisible()
    } )

    test( `no TPN winners falls back to device recommendations`, async ( { page } ) => {
        await page.route( /\/api\/collections\?owner=tpnlabs&limit=50$/, route => route.fulfill( {
            contentType: `application/json`,
            json: [ { title: `TPN-001`, slug: `tpnlabs/tpn-001`, items: [] } ],
        } ) )
        await page.goto( `/select-model` )

        await expect( page.getByTestId( `model-hero-name` ) ).toBeVisible()
        await expect( page.getByTestId( `model-hero-name` ) ).not.toContainText( `winner` )
        await page.getByTestId( `browse-models-toggle` ).click()
        await expect( page.getByTestId( `tpn-model-list` ) ).toHaveCount( 0 )
    } )

    test( `unreachable TPN collection still offers models`, async ( { page } ) => {
        await page.route( /\/api\/collections\?owner=tpnlabs/, route => route.abort( `internetdisconnected` ) )
        await page.goto( `/select-model` )

        await expect( page.getByTestId( `model-hero-name` ) ).toBeVisible()
        await page.getByTestId( `browse-models-toggle` ).click()
        await expect( page.getByTestId( `tpn-models-error` ) ).toContainText( `Couldn't reach` )
    } )

    /**
     * Seed SmolLM2 as a finished download and the active model, the way the app stores it
     * @param {import('@playwright/test').Page} page
     */
    const seed_cached_model = async page => {

        // Wait for the app to create its schema (name follows VITE_APP_NAME)
        const db_name = async () => ( await page.evaluate( () => indexedDB.databases() ) )
            .map( ( { name } ) => name )
            .find( name => name.endsWith( `-db` ) )
        await expect.poll( db_name ).toBeTruthy()
        const name = await db_name()

        await page.evaluate( ( { name } ) => new Promise( ( resolve, reject ) => {
            const request = indexedDB.open( name )
            request.onerror = () => reject( request.error )
            request.onsuccess = () => {
                const tx = request.result.transaction( `models`, `readwrite` )
                tx.objectStore( `models` ).put( {
                    id: `smollm2-360m-q4km`,
                    name: `SmolLM2 360M`,
                    parameters_label: `360M`,
                    file_size_bytes: 271_000_000,
                    last_used_at: Date.now(),
                } )
                tx.oncomplete = () => resolve()
                tx.onerror = () => reject( tx.error )
            }
            localStorage.setItem( `${ name.replace( /-db$/, `` ) }:settings:active_model_id`, `smollm2-360m-q4km` )
        } ), { name } )
        await page.reload()

    }

    test( `cached models are listed with one-click reuse`, async ( { page } ) => {
        await mock_tpn_winners( page )
        await page.goto( `/select-model` )
        await expect( page.getByTestId( `model-hero-name` ) ).toBeVisible()
        await seed_cached_model( page )

        await expect( page.getByTestId( `cached-model-smollm2-360m-q4km` ) ).toContainText( `360M parameters` )
        await expect( page.getByTestId( `back-to-chat-btn` ) ).toBeVisible()
        await page.getByTestId( `use-cached-smollm2-360m-q4km` ).click()
        await expect( page ).toHaveURL( /\/chat/ )
    } )

    test( `cached models can be deleted with a confirming second tap`, async ( { page } ) => {
        await mock_tpn_winners( page )
        await page.goto( `/select-model` )
        await expect( page.getByTestId( `model-hero-name` ) ).toBeVisible()
        await seed_cached_model( page )

        // First tap only arms the button
        const delete_btn = page.getByTestId( `delete-cached-smollm2-360m-q4km` )
        await expect( delete_btn ).toHaveAccessibleName( `Delete SmolLM2 360M from this device` )
        await delete_btn.click()
        await expect( delete_btn ).toHaveText( `Delete` )
        await expect( page.getByTestId( `cached-model-smollm2-360m-q4km` ) ).toBeVisible()

        // Second tap deletes it; it was active, so there is no chat to go back to
        await delete_btn.click()
        await expect( page.getByTestId( `cached-model-list` ) ).toHaveCount( 0 )
        await expect( page.getByTestId( `back-to-chat-btn` ) ).toHaveCount( 0 )

        // Still gone after a reload
        await page.reload()
        await expect( page.getByTestId( `model-hero-name` ) ).toBeVisible()
        await expect( page.getByTestId( `cached-model-list` ) ).toHaveCount( 0 )
    } )

    test( `offline custom model lookup shows a friendly message`, async ( { page } ) => {
        await mock_tpn_winners( page )
        await page.goto( `/select-model` )
        await page.route( /\/api\/models\/bartowski\//, route => route.abort( `internetdisconnected` ) )
        await page.getByTestId( `browse-models-toggle` ).click()

        await page.getByTestId( `custom-model-input` ).fill( `hf.co/bartowski/SmolLM2-360M-Instruct-GGUF:Q4_K_M` )
        await page.getByTestId( `custom-model-load-btn` ).click()

        await expect( page.getByTestId( `custom-model-error` ) ).toContainText( `Couldn't reach Hugging Face` )
        await expect( page.getByTestId( `custom-model-error` ) ).not.toContainText( `Failed to fetch` )
    } )

    test( `language switcher stays available on the picker`, async ( { page } ) => {
        await mock_tpn_winners( page )
        await page.goto( `/select-model` )
        await expect( page.getByTestId( `language-selector` ) ).toBeVisible()
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

    test( `settings basic tab is clean (no temperature/tokens)`, async ( { page } ) => {
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

    test.beforeEach( async ( { page } ) => finish_wizard_before( page ) )

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

    // An open touch keyboard leaves ~half the screen: top bar and composer must both stay on it
    test( `chat fits above the touch keyboard`, async ( { page } ) => {
        await page.goto( `/chat` )
        await page.setViewportSize( { width: 375, height: 340 } )
        await expect( page.getByTestId( `settings-btn` ) ).toBeInViewport( { ratio: 1 } )
        await expect( page.locator( `textarea` ).first() ).toBeInViewport( { ratio: 1 } )
    } )

} )
