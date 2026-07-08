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

    test( `new chat button opens model setup when no model is active`, async ( { page } ) => {
        await page.goto( `/chat` )
        await page.getByTestId( `new-chat-btn` ).click()
        await expect( page ).toHaveURL( /\/select-model/ )
    } )

} )
