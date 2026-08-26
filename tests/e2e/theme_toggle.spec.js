import { test, expect } from '@playwright/test'

// Tests dark-only appearance.
// These tests do NOT require model downloads.

test.describe( `Dark-only theme`, () => {

    test( `theme toggle button is not shown on chat page`, async ( { page } ) => {

        await page.goto( `/chat` )
        await expect( page.getByTestId( `theme-toggle` ) ).toHaveCount( 0 )

    } )

    test( `app resolves to dark mode`, async ( { page } ) => {

        await page.goto( `/chat` )

        const background = await page.evaluate( () =>
            getComputedStyle( document.body ).backgroundColor
        )

        expect( background ).toBe( `rgb(15, 16, 17)` )

    } )

    test( `appearance section is hidden in settings`, async ( { page } ) => {

        await page.goto( `/chat` )

        await page.getByTestId( `settings-btn` ).click()
        await expect( page.getByTestId( `settings-modal` ) ).toBeVisible()
        await expect( page.getByText( `Appearance` ) ).toHaveCount( 0 )

    } )

} )
