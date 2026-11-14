import { test, expect } from '@playwright/test'

test.describe( `Query Parameter Support`, () => {

    test( `query params are cleaned from URL after processing`, async ( { page } ) => {
        await page.goto( `/chat?q=Hello` )
        // The app cleans query params once it has mounted: retried under the
        // config's expect timeout, a fixed 5 s lost to cold dev-server loads
        await expect( page ).not.toHaveURL( /q=Hello/ )
    } )

    // NOTE: "model not found" toast is tested in error_handling.spec.js

    test( `model param is cleaned from URL`, async ( { page } ) => {
        await page.goto( `/chat?model=some-model` )
        await expect( page ).not.toHaveURL( /model=/ )
    } )

} )
