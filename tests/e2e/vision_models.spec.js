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

    test( `the photo switch recommends a model that understands images`, async ( { page } ) => {

        await inject_high_memory( page )
        await page.goto( `/select-model` )
        await expect( page.getByTestId( `model-hero-name` ) ).toBeVisible( { timeout: 15_000 } )

        await page.getByTestId( `adjust-toggle` ).click()
        const photos = page.getByTestId( `need-photos-switch` )
        await photos.click()

        await expect( photos ).toHaveAttribute( `aria-checked`, `true` )
        await expect( page.getByTestId( `model-hero-photos` ) ).toContainText( `Understands photos` )
        await expect( page.getByTestId( `model-select-confirm-btn` ) ).toBeEnabled()
    } )

    test( `?need=vision opens the picker with photos required`, async ( { page } ) => {

        await inject_high_memory( page )
        await page.goto( `/select-model?need=vision` )

        await expect( page.getByTestId( `need-photos-switch` ) ).toHaveAttribute( `aria-checked`, `true` )
        await expect( page.getByTestId( `model-hero-photos` ) ).toContainText( `Understands photos` )
    } )

    test( `the photos filter lists only image-capable models`, async ( { page } ) => {

        await inject_high_memory( page )
        await page.goto( `/select-model` )
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

        await expect( page.getByText( `Pick a model` ) ).toBeVisible()
        await expect( page.getByTestId( `no-fitting-local-model` ) ).toBeVisible()
        await expect( page.getByTestId( `model-select-confirm-btn` ) ).toHaveCount( 0 )
    } )

} )
