import { test, expect } from '@playwright/test'
import { MODELS } from '../fixtures/test_models'
import { select_model_on_page } from '../helpers/download_model'
import { wait_for_inference } from '../helpers/wait_for_inference'

// This test downloads a real model and runs inference — tag @slow for separate runs
test.describe( `E2E Inference`, () => {

    // Long timeout for model download (~260MB) + inference
    test.setTimeout( 600_000 )

    test( `full flow: onboarding → download → chat → inference`, async ( { page } ) => {

        const runtime_logs = []
        page.on( `console`, message => {
            const text = message.text()
            if( text.includes( `[wllama] Loaded` ) ) runtime_logs.push( text )
        } )

        // Step 1 — Welcome page
        await page.goto( `/` )

        // This project runs current Chromium, so it must exercise wllama64's
        // Memory64 runtime rather than silently dropping to wasm32 compatibility.
        const memory64 = await page.evaluate( () => {
            try {
                const memory = new WebAssembly.Memory( { address: `i64`, initial: 1n, maximum: 1n, shared: true } )
                return globalThis.crossOriginIsolated === true
                    && !!WebAssembly.Suspending
                    && memory.grow( 0n ) === 1n
            } catch {
                return false
            }
        } )
        expect( memory64 ).toBe( true )

        await expect( page.getByRole( `heading`, { name: `gratisAI` } ) ).toBeVisible()

        // Wait for device detection to finish so button is enabled
        await expect( page.getByTestId( `get-started-btn` ) ).toBeEnabled( { timeout: 15_000 } )
        await page.getByTestId( `get-started-btn` ).click()

        // Step 2 — Model select page: explicitly pick SmolLM2 (smallest, Docker-friendly)
        await expect( page ).toHaveURL( /\/select-model/ )
        await expect( page.getByText( `Pick a model` ) ).toBeVisible()
        await select_model_on_page( page, MODELS.smollm2 )

        // Confirm the selected model to start download
        await page.getByTestId( `model-select-confirm-btn` ).click()

        // Step 3 — Download page — wait for download to complete
        await expect( page ).toHaveURL( /\/download/ )
        await expect( page.getByTestId( `download-progress-bar` ) ).toBeVisible()

        // Wait until navigated to /chat (download complete)
        await expect( page ).toHaveURL( /\/chat/, { timeout: 240_000 } )

        // Step 4 — Chat page should be ready with suggestions
        await expect( page.getByText( `What can I help with?` ) ).toBeVisible()

        // Wait for the chat input to be enabled (model loaded)
        await expect( page.getByTestId( `chat-input` ) ).toBeEnabled( { timeout: 180_000 } )

        // SmolLM2 advertises 8K and fits the test host's budget. Prove the
        // runtime received a grown context, not merely that the helper chose it.
        const load_log = runtime_logs.find( message => message.includes( MODELS.smollm2.id ) )
        const loaded_context = Number( load_log?.match( /,\s+(\d+)\s+ctx\)/ )?.[ 1 ] )
        expect( loaded_context ).toBeGreaterThan( 2048 )

        // Step 5 — Send a test message
        await page.getByTestId( `chat-input` ).fill( `What is 2+2? Answer with just the number.` )
        await page.getByTestId( `send-btn` ).click()

        // Step 6 — Wait for assistant response with content
        await wait_for_inference( page, 1, 120_000 )

        // Completion stats appear only after streaming has finished.
        await expect( page.getByTestId( `generation-stats` ) ).toBeVisible( { timeout: 120_000 } )

        const response = await page.getByTestId( `assistant-message` ).last().textContent()
        expect( response ).toMatch( /\b4\b/ )
        expect( response ).not.toContain( `empty response` )

    } )

} )
