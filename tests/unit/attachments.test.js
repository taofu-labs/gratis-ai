import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
    IMAGE_MAX_TOKENS,
    MAX_HISTORY_IMAGES,
    compose_user_message,
    deserialize_attachments,
    document_token_budget,
    estimate_history_tokens,
    fit_image_size,
    fit_text_to_tokens,
    read_jpeg_orientation,
    serialize_attachments,
    split_documents,
    to_wllama_messages,
} from '../../src/utils/attachments'
import { estimate_tokens, join_pdf_pages, read_document } from '../../src/utils/document_text'

const fixture = name => new URL( `../fixtures/${ name }`, import.meta.url )
const as_file = ( name, type ) => new File( [ readFileSync( fixture( name ) ) ], name, { type } )

describe( `attachment serialization`, () => {

    test( `images round-trip through the IndexedDB shape with their bytes and type`, async () => {

        const image = { kind: `image`, mime: `image/png`, name: `shot.png`, width: 4, height: 2, data: new Blob( [ new Uint8Array( [ 1, 2, 3 ] ) ], { type: `image/png` } ) }
        const document = { kind: `document`, name: `a.pdf`, pages: 3, chars: 10, truncated: false, empty_pages: [ 2 ] }

        const stored = await serialize_attachments( [ image, document ] )

        // Stored records hold plain bytes, never a Blob
        expect( stored[ 0 ].data ).toBeUndefined()
        expect( stored[ 0 ].bytes ).toBeInstanceOf( ArrayBuffer )
        expect( stored[ 1 ] ).toEqual( document )
        expect( structuredClone( stored ) ).toEqual( stored )

        const [ restored_image, restored_document ] = deserialize_attachments( stored )
        expect( restored_image ).toMatchObject( { kind: `image`, mime: `image/png`, name: `shot.png`, width: 4, height: 2 } )
        expect( restored_image.data.type ).toBe( `image/png` )
        expect( [ ...new Uint8Array( await restored_image.data.arrayBuffer() ) ] ).toEqual( [ 1, 2, 3 ] )
        expect( restored_document ).toEqual( document )

    } )

    test( `messages without attachments store null and load as undefined`, async () => {
        expect( await serialize_attachments( undefined ) ).toBeNull()
        expect( await serialize_attachments( [] ) ).toBeNull()
        expect( deserialize_attachments( null ) ).toBeUndefined()
    } )

} )

describe( `document budget`, () => {

    test( `token estimate counts non-ASCII scripts one per character`, () => {
        expect( estimate_tokens( `abcd`.repeat( 100 ) ) ).toBe( 100 )
        expect( estimate_tokens( `日本語のテキスト` ) ).toBe( 8 )
    } )

    test( `the budget reserves room for the reply, images, and the template`, () => {
        const budget = document_token_budget( { context_size: 8192, history_tokens: 1000, max_tokens: 2048 } )
        expect( budget ).toBe( 8192 - 1000 - 2048 - 256 )

        // The reply reservation never exceeds a quarter of the context
        expect( document_token_budget( { context_size: 4096, max_tokens: 4096 } ) ).toBe( 4096 - 1024 - 256 )
        expect( document_token_budget( { context_size: 8192, max_tokens: 1024, image_count: 2 } ) ).toBe( 8192 - 1024 - 256 - 2 * IMAGE_MAX_TOKENS )
        expect( document_token_budget( { context_size: 2048, history_tokens: 5000 } ) ).toBe( 0 )
    } )

    test( `a document over budget is cut at a boundary and marked`, () => {
        const text = Array.from( { length: 400 }, ( _, index ) => `line ${ index } of the report` ).join( `\n` )
        const fitted = fit_text_to_tokens( text, 200 )
        expect( fitted.truncated ).toBe( true )
        expect( estimate_tokens( fitted.text ) ).toBeLessThanOrEqual( 200 )
        expect( text.startsWith( fitted.text ) ).toBe( true )
        expect( fitted.text.endsWith( `report` ) ).toBe( true )
        expect( fit_text_to_tokens( `short`, 200 ) ).toEqual( { text: `short`, truncated: false } )
    } )

    test( `composed messages inline documents and keep chip metadata`, () => {

        const long_text = `word `.repeat( 4000 )
        const { content, attachments } = compose_user_message( {
            text: `  Summarise both  `,
            documents: [
                { name: `small "notes".txt`, text: `alpha beta`, pages: null, empty_pages: [] },
                { name: `big.pdf`, text: long_text, pages: 12, empty_pages: [ 3 ] },
            ],
            budget_tokens: 500,
        } )

        expect( content.endsWith( `Summarise both` ) ).toBe( true )
        expect( estimate_tokens( content ) ).toBeLessThan( 600 )
        expect( attachments ).toEqual( [
            { kind: `document`, name: `small "notes".txt`, pages: null, chars: 10, truncated: false, empty_pages: [] },
            expect.objectContaining( { kind: `document`, name: `big.pdf`, pages: 12, truncated: true, empty_pages: [ 3 ] } ),
        ] )

        // What the bubble shows and what an edit re-sends
        const { text, names, blocks } = split_documents( content )
        expect( text ).toBe( `Summarise both` )
        expect( names ).toEqual( [ `small "notes".txt`, `big.pdf` ] )
        expect( `${ blocks }${ text }` ).toBe( content )

    } )

    test( `history tokens count text and capped images`, () => {
        const image = { kind: `image` }
        const tokens = estimate_history_tokens( [
            { role: `user`, content: `abcd`.repeat( 10 ), attachments: Array( MAX_HISTORY_IMAGES + 3 ).fill( image ) },
            { role: `assistant`, content: `ok` },
        ] )
        expect( tokens ).toBe( 10 + 8 + MAX_HISTORY_IMAGES * IMAGE_MAX_TOKENS + 1 + 8 )
    } )

} )

describe( `documents`, () => {

    test( `PDF text is extracted per page and empty pages are reported`, async () => {
        const document = await read_document( as_file( `quarterly_note.pdf`, `application/pdf` ) )
        expect( document.pages ).toBe( 3 )
        expect( document.empty_pages ).toEqual( [ 2 ] )
        expect( document.text ).toContain( `314 kayaks` )
        expect( document.text ).toContain( `[Page 3]` )
    } )

    test( `an image-only PDF is a clear error, not an empty document`, async () => {
        await expect( read_document( as_file( `scanned.pdf`, `application/pdf` ) ) ).rejects.toMatchObject( { code: `image_only` } )
    } )

    test( `text files pass through and unknown types are refused`, async () => {
        const text_file = new File( [ `hello` ], `notes.md`, { type: `` } )
        expect( await read_document( text_file ) ).toMatchObject( { text: `hello`, pages: null } )
        await expect( read_document( new File( [ `x` ], `data.xyz` ) ) ).rejects.toMatchObject( { code: `unsupported` } )
    } )

    test( `page joining numbers only multi-page documents`, () => {
        expect( join_pdf_pages( [ `only page  \n\n\n\nend` ] ) ).toEqual( { text: `only page\n\nend`, empty_pages: [] } )
        expect( join_pdf_pages( [ ` `, `b` ] ) ).toEqual( { text: `[Page 2]\nb`, empty_pages: [ 1 ] } )
    } )

} )

describe( `images`, () => {

    test( `downscales only when the long side exceeds 2048 px, keeping aspect`, () => {
        expect( fit_image_size( 1920, 1080 ) ).toEqual( { width: 1920, height: 1080, scaled: false } )
        expect( fit_image_size( 4096, 3072 ) ).toEqual( { width: 2048, height: 1536, scaled: true } )
        expect( fit_image_size( 1000, 5000 ) ).toEqual( { width: 410, height: 2048, scaled: true } )
    } )

    test( `reads the EXIF orientation of a JPEG`, () => {

        // SOI, APP1 Exif with a little-endian TIFF holding orientation 6
        const bytes = new Uint8Array( [
            0xFF, 0xD8,
            0xFF, 0xE1, 0x00, 0x22,
            0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
            0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
            0x01, 0x00,
            0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
        ] )
        expect( read_jpeg_orientation( bytes.buffer ) ).toBe( 6 )
        expect( read_jpeg_orientation( new Uint8Array( [ 0x89, 0x50, 0x4E, 0x47 ] ).buffer ) ).toBe( 1 )
        expect( read_jpeg_orientation( new Uint8Array( [ 0xFF, 0xD8, 0xFF, 0xDA, 0x00, 0x02 ] ).buffer ) ).toBe( 1 )

    } )

    test( `provider messages carry image parts first and drop the oldest images`, async () => {

        const image = id => ( { kind: `image`, mime: `image/png`, name: `${ id }.png`, data: new Blob( [ new Uint8Array( [ id ] ) ] ) } )
        const messages = [
            { role: `system`, content: `be brief` },
            { role: `user`, content: `first`, attachments: [ image( 1 ), image( 2 ) ] },
            { role: `assistant`, content: `ok` },
            { role: `user`, content: `second`, attachments: [ image( 3 ), image( 4 ), image( 5 ), { kind: `document`, name: `a.pdf` } ] },
        ]

        const converted = await to_wllama_messages( messages )

        expect( converted[ 0 ] ).toEqual( { role: `system`, content: `be brief` } )
        expect( converted[ 2 ] ).toEqual( { role: `assistant`, content: `ok` } )

        // Four newest images survive: 2, 3, 4, 5
        expect( converted[ 1 ].content.map( ( { type } ) => type ) ).toEqual( [ `image`, `text` ] )
        expect( converted[ 1 ].content[ 1 ].text ).toBe( `[1 earlier image omitted]\nfirst` )
        expect( converted[ 3 ].content.map( ( { type } ) => type ) ).toEqual( [ `image`, `image`, `image`, `text` ] )
        expect( [ ...new Uint8Array( converted[ 3 ].content[ 0 ].data ) ] ).toEqual( [ 3 ] )
        expect( converted[ 3 ].content.at( -1 ) ).toEqual( { type: `text`, text: `second` } )

    } )

} )
