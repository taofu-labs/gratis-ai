import { test, expect } from '@playwright/test'

// A returning user lands on the home page, which hosts the chat input
test.beforeEach( async ( { page } ) => {
    await page.addInitScript( () => localStorage.setItem( `gratis:settings:active_model_id`, `fake-model` ) )
} )

const open_settings = page => page.getByRole( `button`, { name: `Open settings` } ).first().click()

test.describe( `PWA shell`, () => {

    test( `desktop install pill points at the native apps`, async ( { page } ) => {

        await page.goto( `/` )
        await expect( page.getByTestId( `install-app-pill` ) ).toHaveAttribute( `href`, `/get-app` )

        await page.getByTestId( `install-app-pill` ).click()
        await expect( page ).toHaveURL( /\/get-app$/ )
        await expect( page.getByTestId( `install-app-pill` ) ).toHaveCount( 0 )

    } )

    test( `settings show the build and "Update app" reinstalls the service worker`, async ( { page } ) => {

        await page.goto( `/` )
        await page.evaluate( () => navigator.serviceWorker.ready )

        await open_settings( page )
        await expect( page.getByTestId( `build-info` ) ).toHaveText( /^v\d+\.\d+\.\d+ · [0-9a-f]{7}|dev$/ )

        const reloaded = page.waitForEvent( `load` )
        await page.getByTestId( `update-app-btn` ).click()
        await reloaded

        // Fresh from the network, still isolated, and a worker installs again
        expect( await page.evaluate( () => crossOriginIsolated ) ).toBe( true )
        await page.evaluate( () => navigator.serviceWorker.ready )

    } )

    test( `an update reload keeps the typed draft; a manual reload does not`, async ( { page } ) => {

        await page.goto( `/` )
        const input = page.locator( `textarea` ).first()
        await input.fill( `half a question` )

        const reloaded = page.waitForEvent( `load` )
        // What reload_for_update() does when a new service worker takes over
        await page.evaluate( () => {
            window.dispatchEvent( new CustomEvent( `gratis:before-update-reload` ) )
            window.location.reload()
        } )
        await reloaded
        await expect( page.locator( `textarea` ).first() ).toHaveValue( `half a question` )

        await page.reload()
        await expect( page.locator( `textarea` ).first() ).toHaveValue( `` )

    } )

} )
