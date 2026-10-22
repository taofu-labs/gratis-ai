import { test, expect } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

// Create temporary test files for attachment tests
const tmp_dir = join( tmpdir(), `gratisai-test-files` )
const fixtures = fileURLToPath( new URL( `../fixtures/`, import.meta.url ) )

// 1×1 transparent PNG
const TINY_PNG = Buffer.from( `iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==`, `base64` )

test.beforeAll( () => {
    mkdirSync( tmp_dir, { recursive: true } )

    // Small text file
    writeFileSync( join( tmp_dir, `hello.js` ), `console.log( "hello" )` )

    // Oversized text file (over the 5 MB reading limit)
    writeFileSync( join( tmp_dir, `big.txt` ), `x`.repeat( 5_100_000 ) )

    // A real, decodable image
    writeFileSync( join( tmp_dir, `photo.png` ), TINY_PNG )

    // Unsupported file type
    writeFileSync( join( tmp_dir, `data.xyz` ), `some data` )
} )

/** Paste a generated PNG into the chat input, as a screenshot paste would. */
const paste_image = page => page.getByTestId( `chat-input` ).evaluate( async input => {
    const canvas = document.createElement( `canvas` )
    canvas.width = 120
    canvas.height = 60
    const context = canvas.getContext( `2d` )
    context.fillStyle = `#fff`
    context.fillRect( 0, 0, 120, 60 )
    context.fillStyle = `#1d4ed8`
    context.fillText( `BLUE 42`, 10, 35 )
    const blob = await new Promise( resolve => canvas.toBlob( resolve, `image/png` ) )
    const data = new DataTransfer()
    data.items.add( new File( [ blob ], `screenshot.png`, { type: `image/png` } ) )
    input.dispatchEvent( new ClipboardEvent( `paste`, { clipboardData: data, bubbles: true, cancelable: true } ) )
} )

test.describe( `File Attachment`, () => {

    test( `attach button is visible in chat input`, async ( { page } ) => {
        await page.goto( `/chat` )
        await expect( page.getByTestId( `attach-btn` ) ).toBeVisible()
    } )

    test( `attach button has correct aria label`, async ( { page } ) => {
        await page.goto( `/chat` )
        await expect( page.getByTestId( `attach-btn` ) ).toHaveAttribute( `aria-label`, `Attach file` )
    } )

    test( `attaching a text file shows chip with filename`, async ( { page } ) => {
        await page.goto( `/chat` )

        // Use the hidden file input directly to attach a file
        const file_input = page.getByTestId( `file-input` )
        await file_input.setInputFiles( join( tmp_dir, `hello.js` ) )

        // Chip should appear with the filename
        await expect( page.getByTestId( `draft-document` ) ).toContainText( `hello.js` )
    } )

    test( `removing attached file clears the chip`, async ( { page } ) => {
        await page.goto( `/chat` )

        // Attach file
        const file_input = page.getByTestId( `file-input` )
        await file_input.setInputFiles( join( tmp_dir, `hello.js` ) )
        await expect( page.getByText( `hello.js` ) ).toBeVisible()

        // Click the remove button (X)
        await page.getByRole( `button`, { name: `Remove attachment` } ).click()

        // Chip should be gone
        await expect( page.getByText( `hello.js` ) ).not.toBeVisible()
    } )

    test( `a PDF chip shows its pages and the pages without text`, async ( { page } ) => {
        await page.goto( `/chat` )

        await page.getByTestId( `file-input` ).setInputFiles( join( fixtures, `quarterly_note.pdf` ) )

        const chip = page.getByTestId( `draft-document` )
        await expect( chip ).toContainText( `quarterly_note.pdf` )
        await expect( chip ).toContainText( `Pages: 3` )
        await expect( chip ).toContainText( `no text on p. 2` )
    } )

    test( `an image-only PDF explains that there is no text to read`, async ( { page } ) => {
        await page.goto( `/chat` )

        await page.getByTestId( `file-input` ).setInputFiles( join( fixtures, `scanned.pdf` ) )

        await expect( page.getByText( /no text layer/i ) ).toBeVisible( { timeout: 10_000 } )
        await expect( page.getByTestId( `draft-document` ) ).toHaveCount( 0 )
    } )

    test( `pasting an image shows a removable thumbnail`, async ( { page } ) => {
        await page.goto( `/chat` )
        await expect( page.getByTestId( `chat-input` ) ).toBeVisible()

        await paste_image( page )
        await expect( page.getByTestId( `draft-image` ) ).toHaveCount( 1 )
        await expect( page.getByTestId( `draft-image` ).locator( `img` ) ).toHaveAttribute( `src`, /^blob:/ )

        await page.getByTestId( `draft-image` ).getByRole( `button`, { name: `Remove attachment` } ).click()
        await expect( page.getByTestId( `draft-image` ) ).toHaveCount( 0 )
    } )

    test( `an image for a model without image input keeps the draft and offers a vision model`, async ( { page } ) => {
        await page.goto( `/chat` )

        await page.getByTestId( `file-input` ).setInputFiles( join( tmp_dir, `photo.png` ) )
        await expect( page.getByTestId( `draft-image` ) ).toHaveCount( 1 )

        // Inline offer instead of a toast; sending stays blocked
        const notice = page.getByTestId( `vision-notice` )
        await expect( notice ).toContainText( /can’t read images/ )
        await expect( page.getByTestId( `send-btn` ) ).toBeDisabled()

        // The picker learns what is needed; coming back finds the draft intact
        await notice.getByTestId( `choose-vision-model` ).click()
        await expect( page ).toHaveURL( /\/select-model\?need=vision/ )
        await page.goBack()
        await expect( page.getByTestId( `draft-image` ) ).toHaveCount( 1 )
    } )

    test( `attaching an oversized file shows size toast`, async ( { page } ) => {
        await page.goto( `/chat` )

        const file_input = page.getByTestId( `file-input` )
        await file_input.setInputFiles( join( tmp_dir, `big.txt` ) )

        // Should show a toast about file being too large
        await expect( page.getByText( /too large/i ) ).toBeVisible( { timeout: 5_000 } )

        // No chip should appear
        await expect( page.getByTestId( `draft-document` ) ).toHaveCount( 0 )
    } )

    test( `attaching an unsupported file type shows error toast`, async ( { page } ) => {
        await page.goto( `/chat` )

        const file_input = page.getByTestId( `file-input` )
        await file_input.setInputFiles( join( tmp_dir, `data.xyz` ) )

        // Should show a toast about unsupported file type
        await expect( page.getByText( /not supported/i ) ).toBeVisible( { timeout: 5_000 } )

        // No chip should appear
        await expect( page.getByText( `data.xyz` ) ).not.toBeVisible()
    } )

} )
