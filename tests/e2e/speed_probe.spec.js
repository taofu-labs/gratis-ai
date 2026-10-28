import { test, expect } from '@playwright/test'
import { skip_model_wizard } from '../helpers/download_model'

// The picker times a zero-weight skeleton of the smallest catalog model (only
// its header is downloaded) and scales every reference speed to this browser
test( `the speed probe measures this browser and the picker shows tok/s`, async ( { page } ) => {

    test.setTimeout( 180_000 )

    // Automated browsers skip the probe unless a test opts in
    await page.addInitScript( () => localStorage.setItem( `gratis:settings:force_speed_probe`, `1` ) )
    await page.goto( `/select-model` )
    await skip_model_wizard( page )
    await expect( page.getByTestId( `model-hero-tps` ) ).toContainText( /~[\d.]+ tok\/s/, { timeout: 15_000 } )

    const read_ratio = () => page.evaluate( () => JSON.parse( localStorage.getItem( `gratis:settings:speed_ratio` ) || `null` ) )
    await expect.poll( read_ratio, { timeout: 150_000, intervals: [ 2_000 ] } ).toMatchObject( { probe: true } )

    const { ratio } = await read_ratio()
    expect( ratio ).toBeGreaterThan( 0.05 )
    expect( ratio ).toBeLessThan( 20 )

    // Model rows carry the estimate too
    await page.getByTestId( `browse-models-toggle` ).click()
    await expect( page.getByTestId( `model-browser` ).getByText( /tok\/s/ ).first() ).toBeVisible()

} )
