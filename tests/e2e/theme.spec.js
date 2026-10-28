import { test, expect } from '@playwright/test'

// Tests the device-following theme: paper by day, deep blue by night.
// These tests do NOT require model downloads.

const PAPER = `rgb(247, 246, 242)`
const DEEP_BLUE = `rgb(0, 43, 54)`

const body_background = page => page.evaluate( () => getComputedStyle( document.body ).backgroundColor )

test.describe( `Device-following theme`, () => {

    test( `theme toggle button is not shown on chat page`, async ( { page } ) => {

        await page.goto( `/chat` )
        await expect( page.getByTestId( `theme-toggle` ) ).toHaveCount( 0 )

    } )

    test( `light device gets the paper theme`, async ( { page } ) => {

        await page.emulateMedia( { colorScheme: `light` } )
        await page.goto( `/chat` )
        await expect.poll( () => body_background( page ) ).toBe( PAPER )

    } )

    test( `dark device gets the deep blue theme`, async ( { page } ) => {

        await page.emulateMedia( { colorScheme: `dark` } )
        await page.goto( `/chat` )
        await expect.poll( () => body_background( page ) ).toBe( DEEP_BLUE )

    } )

    test( `theme follows the device switching live`, async ( { page } ) => {

        await page.emulateMedia( { colorScheme: `light` } )
        await page.goto( `/chat` )
        await expect.poll( () => body_background( page ) ).toBe( PAPER )

        await page.emulateMedia( { colorScheme: `dark` } )
        await expect.poll( () => body_background( page ) ).toBe( DEEP_BLUE )

    } )

    test( `appearance section is hidden in settings`, async ( { page } ) => {

        await page.goto( `/chat` )

        await page.getByTestId( `settings-btn` ).click()
        await expect( page.getByTestId( `settings-modal` ) ).toBeVisible()
        await expect( page.getByText( `Appearance` ) ).toHaveCount( 0 )

    } )

} )
