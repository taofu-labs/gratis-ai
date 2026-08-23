import { expect } from '@playwright/test'

/**
 * Waits for the assistant to produce at least `min_length` characters of response.
 * Polls the last assistant message bubble.
 * @param {import('@playwright/test').Page} page
 * @param {number} min_length - Minimum characters to wait for
 * @param {number} timeout - Maximum wait time in ms
 */
export async function wait_for_inference( page, min_length = 10, timeout = 90_000 ) {

    await expect( async () => {

        const user_count = await page.getByTestId( `user-message` ).count()
        const messages = await page.locator( `[data-testid="assistant-message"]` ).all()
        const last_message = messages[ messages.length - 1 ]

        // Match the current user turn, then wait for generation to finish. A
        // previous response must never satisfy a newly submitted request.
        expect( user_count ).toBeGreaterThan( 0 )
        expect( messages.length ).toBeGreaterThanOrEqual( user_count )
        await expect( page.getByTestId( `stop-btn` ) ).toHaveCount( 0 )
        expect( last_message ).toBeDefined()
        await expect( last_message.getByTestId( `waking-up-indicator` ) ).toHaveCount( 0 )
        const text = await last_message.textContent()
        expect( text?.length ).toBeGreaterThanOrEqual( min_length )

    } ).toPass( { timeout } )

}
