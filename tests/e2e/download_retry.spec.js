import { test, expect } from '@playwright/test'
import { MODELS } from '../fixtures/test_models'
import { select_model_on_page } from '../helpers/download_model'

test.describe( `Download retry and cancel`, () => {

    test.setTimeout( 600_000 )

    test( `a failed download offers Retry, which completes it`, async ( { page } ) => {

        await page.goto( `/` )
        await page.getByTestId( `get-started-btn` ).click()
        await select_model_on_page( page, MODELS.smollm2 )

        // The connection drops for the model file until the user retries
        let offline = true
        await page.route( url => url.href.includes( MODELS.smollm2.file_name ), route => offline
            ? route.abort( `internetdisconnected` )
            : route.continue() )
        await page.getByTestId( `model-select-confirm-btn` ).click()

        // Not a dead end: the error comes with a way forward
        const retry = page.getByTestId( `retry-download-btn` )
        await expect( retry ).toBeVisible( { timeout: 60_000 } )
        offline = false
        await retry.click()

        await expect( page ).toHaveURL( /\/chat/, { timeout: 300_000 } )
        await expect( page.getByTestId( `chat-input` ) ).toBeEnabled( { timeout: 180_000 } )

    } )

    test( `a cancelled download steps back to the picker it came from, never stacking a second one`, async ( { page } ) => {

        await page.goto( `/` )
        await page.getByTestId( `get-started-btn` ).click()
        await select_model_on_page( page, MODELS.smollm2 )

        // The model file never arrives, so every download waits to be cancelled
        await page.route( url => url.href.includes( MODELS.smollm2.file_name ), () => {} )
        const history_length = () => page.evaluate( () => history.length )
        const entries_at_picker = await history_length()

        // Cancel twice: each round must end on the same picker entry
        for( const round of [ 1, 2 ] ) {
            await page.getByTestId( `model-select-confirm-btn` ).click()
            await expect( page, `round ${ round }` ).toHaveURL( /\/download/ )
            await page.getByTestId( `cancel-download-btn` ).click()
            await expect( page ).toHaveURL( /\/select-model/ )
            await select_model_on_page( page, MODELS.smollm2 )
        }
        expect( await history_length() ).toBeLessThanOrEqual( entries_at_picker + 1 )

        // One Back leaves the picker (it used to take one press per cancelled download)
        await page.goBack()
        await expect( page ).not.toHaveURL( /\/select-model/ )

    } )

    test( `a download page without a picker behind it still lands on the picker`, async ( { page } ) => {

        // Deep link: no model in the navigation state, nothing to step back to
        await page.goto( `/download` )
        await expect( page ).toHaveURL( /\/select-model/ )

    } )

} )
