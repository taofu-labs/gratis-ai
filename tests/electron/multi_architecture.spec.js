import { test, expect } from '@playwright/test'
import fs from 'fs'
import { MODELS, TEST_PROMPT } from '../fixtures/test_models'
import { launch_electron, preload_model, send_message } from '../helpers/electron_helpers'
import { wait_for_inference } from '../helpers/wait_for_inference'

// Multi-architecture native inference tests via Electron.
// Pre-downloads models to filesystem for speed, then loads and infers.
// Covers: SmolLM2 (ChatML), TinyLlama (Zephyr), DeepSeek R1 (ChatML/Qwen).

const CACHE_DIR = `/tmp/gratisai-test-models`
const MODELS_TO_TEST = [ MODELS.smollm2, MODELS.tinyllama, MODELS.llama32, MODELS.deepseek ]

// Skip if no pre-downloaded models available
const has_cache = fs.existsSync( CACHE_DIR )

let app
let page

test.describe( `Electron Multi-Architecture Inference`, () => {

    test.setTimeout( 600_000 )

    // Skip the entire suite if no model cache is available
    test.skip( !has_cache, `No model cache at ${ CACHE_DIR }. Run scripts/download_test_models.sh first.` )

    test.beforeAll( async () => {

        const result = await launch_electron()
        app = result.app
        page = result.page

    } )

    test.afterAll( async () => {
        if( app ) await app.close()
    } )

    for( const model of MODELS_TO_TEST ) {

        test( `native inference with ${ model.name } (${ model.template })`, async () => {

            // Check that this specific model file exists in cache
            const model_path = `${ CACHE_DIR }/${ model.file_name }`
            test.skip( !fs.existsSync( model_path ), `${ model.file_name } not found in cache` )

            // Pre-load the model into Electron's models directory
            await preload_model( app, model, CACHE_DIR )

            // Reload the packaged entry point so the renderer sees the updated
            // native manifest. Returning users keep their current route, so use
            // whichever real switch-model affordance that route exposes.
            await page.reload()

            const get_started = page.getByTestId( `get-started-btn` )
            const home_switch = page.getByTestId( `home-switch-model` )
            const chat_switch = page.getByTestId( `change-model-btn` )

            // Route restoration and lazy chunks settle asynchronously after a
            // production reload. Wait for one valid entry point before branching.
            await expect( get_started.or( home_switch ).or( chat_switch ) ).toBeVisible( { timeout: 15_000 } )

            if( await get_started.isVisible() ) {
                await expect( get_started ).toBeEnabled( { timeout: 15_000 } )
                await get_started.click()
            } else if( await home_switch.isVisible() ) {
                await home_switch.click()
            } else {
                await expect( chat_switch ).toBeVisible( { timeout: 15_000 } )
                await chat_switch.click()
            }

            // Select the pre-loaded model
            await expect( page ).toHaveURL( /\/select-model/ )
            await page.getByTestId( `change-model-toggle` ).click()
            const option = page.getByTestId( `model-option-${ model.id }` )
            await expect( option ).toBeVisible( { timeout: 5_000 } )
            await option.click()
            await page.getByTestId( `model-select-confirm-btn` ).click()

            // Wait for chat to be ready (model should load from pre-cached file)
            await expect( page ).toHaveURL( /\/chat/, { timeout: 120_000 } )
            await expect( page.getByTestId( `chat-input` ) ).toBeEnabled( { timeout: 120_000 } )

            // Send test prompt
            await send_message( page, TEST_PROMPT )

            // Wait for native inference
            await wait_for_inference( page, 1, 120_000 )

            // Verify response
            const messages = await page.locator( `[data-testid="assistant-message"]` ).all()
            const text = await messages[ messages.length - 1 ].textContent()
            await expect( page.getByTestId( `generation-stats` ) ).toBeVisible()
            expect( text ).toMatch( /\b4\b/ )
            expect( text ).not.toContain( `empty response` )

        } )

    }

} )
