import { test, expect } from '@playwright/test'
import { MODELS } from '../fixtures/test_models'
import { select_model_on_page } from '../helpers/download_model'

test.describe( `Download retry`, () => {

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

} )
