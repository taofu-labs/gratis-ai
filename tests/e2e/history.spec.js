import { test, expect } from '@playwright/test'

test.describe( `Chat History`, () => {

    test( `sidebar shows no conversations initially`, async ( { page } ) => {
        await page.goto( `/chat` )
        await expect( page.getByText( /conversations will appear here/i ) ).toBeVisible()
    } )

    test( `new chat button is visible`, async ( { page } ) => {
        await page.goto( `/chat` )
        await expect( page.getByTestId( `new-chat-btn` ) ).toBeVisible()
    } )

    test( `new chat button navigates to empty chat`, async ( { page } ) => {
        await page.goto( `/chat` )
        await page.getByTestId( `new-chat-btn` ).click()
        // Without a model loaded, shows the setup CTA
        await expect( page.getByText( `Let's get you set up` ) ).toBeVisible()
    } )

} )
