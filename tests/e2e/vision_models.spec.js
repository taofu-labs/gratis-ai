import { test, expect } from '@playwright/test'

// Headless Chromium often reports low deviceMemory (~2 GB) and a tight
// jsHeapSizeLimit. Present an ordinary 8 GB laptop instead.
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

    test( `a first visit walks a non-techie through photos, care and speed`, async ( { page } ) => {

        await inject_high_memory( page )
        await page.goto( `/select-model` )

        const wizard = page.getByTestId( `model-wizard` )
        await expect( wizard ).toHaveAttribute( `data-question`, `photos` )
        await expect( wizard ).toContainText( `Question 1 of` )
        await expect( page.getByTestId( `wizard-back` ) ).toHaveCount( 0 )

        // Every answer says what it means here: a download size and a speed
        await expect( page.getByTestId( `wizard-photos-photos_yes` ) ).toContainText( /download ·/ )
        await page.getByTestId( `wizard-photos-photos_yes` ).click()

        await expect( wizard ).toHaveAttribute( `data-question`, `topics` )
        await page.getByTestId( `wizard-back` ).click()
        await expect( wizard ).toHaveAttribute( `data-question`, `photos` )
        await expect( page.getByTestId( `wizard-photos-photos_yes` ) ).toHaveAttribute( `aria-pressed`, `true` )
        await page.getByTestId( `wizard-photos-photos_yes` ).click()
        await page.getByTestId( `wizard-topics-topics_careful` ).click()

        // Speed is asked only when this device has a real choice
        const speed = page.locator( `[data-testid^="wizard-speed-"]` )
        if( await speed.count() ) await speed.last().click()

        await expect( page.getByTestId( `model-hero-photos` ) ).toContainText( `Understands photos` )
        await expect( page.getByTestId( `model-select-confirm-btn` ) ).toBeEnabled()
        await expect( page.getByTestId( `wizard-edit-photos` ) ).toContainText( `Photos too` )

        // Finished once: the next visit opens on the recommendation
        await page.reload()
        await expect( page.getByTestId( `model-hero-photos` ) ).toContainText( `Understands photos` )
        await expect( page.getByTestId( `model-wizard` ) ).toHaveCount( 0 )
    } )

    test( `changing the care answer from the summary changes the recommendation`, async ( { page } ) => {

        await inject_high_memory( page )
        await page.goto( `/select-model` )
        await page.getByTestId( `wizard-skip` ).click()

        const name = page.getByTestId( `model-hero-name` )
        await expect( name ).toBeVisible( { timeout: 15_000 } )
        const standard = await name.textContent()

        await page.getByTestId( `wizard-edit-topics` ).click()
        await expect( page.getByText( `modified to refuse less` ) ).toBeVisible()
        await page.getByTestId( `wizard-topics-topics_free` ).click()

        const speed = page.locator( `[data-testid^="wizard-speed-"]` )
        if( await speed.count() ) await page.getByTestId( `wizard-skip` ).click()

        await expect( page.getByTestId( `wizard-edit-topics` ) ).toContainText( `Answers freely` )
        await expect( name ).not.toHaveText( standard )
    } )

    test( `?need=vision skips the wizard with photos required`, async ( { page } ) => {

        await inject_high_memory( page )
        await page.goto( `/select-model?need=vision` )

        await expect( page.getByTestId( `model-wizard` ) ).toHaveCount( 0 )
        await expect( page.getByTestId( `wizard-edit-photos` ) ).toContainText( `Photos too` )
        await expect( page.getByTestId( `model-hero-photos` ) ).toContainText( `Understands photos` )
    } )

    test( `the photos filter lists only image-capable models`, async ( { page } ) => {

        await inject_high_memory( page )
        await page.goto( `/select-model` )
        await page.getByTestId( `wizard-skip` ).click()
        await page.getByTestId( `browse-models-toggle` ).click()
        await page.getByTestId( `filter-photos` ).click()

        const rows = page.getByTestId( `catalog-model-list` ).locator( `button` )
        await expect( rows.first() ).toBeVisible()
        for( const row of await rows.all() ) await expect( row ).toContainText( `Photos` )
    } )

    test( `download navigates after choosing a photo model`, async ( { page } ) => {

        await inject_high_memory( page )

        // Multi-GB picks save to a user-chosen file when the File System Access
        // API exists; a native save dialog would block this navigation check
        await page.addInitScript( () => {
            delete window.showSaveFilePicker
        } )
        await page.goto( `/select-model?need=vision` )

        const download_btn = page.getByTestId( `model-select-confirm-btn` )
        await expect( download_btn ).toBeEnabled( { timeout: 15_000 } )
        await download_btn.click()

        await expect( page ).toHaveURL( /\/download/ )
    } )

    test( `nothing is offered when memory is too low`, async ( { page } ) => {

        // Simulate an old low-memory browser: Memory64 browsers deliberately
        // ignore privacy-clamped deviceMemory, so the wasm32 budget must apply
        await page.addInitScript( () => {
            Object.defineProperty( navigator, `deviceMemory`, { get: () => 1, configurable: true } )
            const NativeMemory = WebAssembly.Memory
            WebAssembly.Memory = function( descriptor ) {
                if( descriptor?.address === `i64` ) throw new TypeError( `Memory64 unavailable` )
                return new NativeMemory( descriptor )
            }
        } )

        await page.goto( `/select-model` )
        await page.getByTestId( `wizard-skip` ).click()

        await expect( page.getByText( `Pick a model` ) ).toBeVisible()
        await expect( page.getByTestId( `no-fitting-local-model` ) ).toBeVisible()
        await expect( page.getByTestId( `model-select-confirm-btn` ) ).toHaveCount( 0 )
    } )

} )
