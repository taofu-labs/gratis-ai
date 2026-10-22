/**
 * Chat attachments: images the model sees, and documents inlined as text.
 *
 * In memory an image is `{ kind: 'image', mime, name, data: Blob, width, height }`.
 * Documents never reach the provider as attachments: their text is inlined
 * into the message content as `<document name="…">…</document>` blocks and the
 * attachment only keeps chip metadata `{ kind: 'document', name, pages, chars,
 * truncated, empty_pages }`.
 *
 * @module attachments
 */

import { estimate_tokens } from './document_text'

// Image token range for the browser runtime (wllama `image_min_tokens` /
// `image_max_tokens`); budgets count the maximum. Measured with Qwen 3.5 0.8B:
// at the default ~200 tokens a 640×320 "BLUE 42" read as "212"; with a
// 512 floor it read the text exactly, at ~2.5× the encode time.
export const IMAGE_MIN_TOKENS = 512
export const IMAGE_MAX_TOKENS = 1024

// Images above this long side are downscaled before they are stored or sent
export const MAX_IMAGE_SIDE = 2048

// Older images in a conversation become a short note; every image is
// re-encoded on each turn, which is slow on CPU and eats context
export const MAX_HISTORY_IMAGES = 4

// Formats the native decoder (stb_image) reads as-is
const PASSTHROUGH_MIMES = new Set( [ `image/png`, `image/jpeg` ] )

export const is_image_file = file => /^image\//.test( file?.type || `` )
    || /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i.test( file?.name || `` )


// ─── Image preparation ─────────────────────────────────────────────────────────

/**
 * Read the EXIF orientation of a JPEG (1 = upright). Non-JPEG or missing EXIF
 * yields 1. Only the first 64 KiB are needed: APP1 sits right after SOI.
 * @param {ArrayBuffer} buffer
 * @returns {number} Orientation 1–8
 */
export const read_jpeg_orientation = buffer => {

    const view = new DataView( buffer )
    if( view.byteLength < 4 || view.getUint16( 0 ) !== 0xFFD8 ) return 1

    let offset = 2
    while( offset + 4 <= view.byteLength ) {

        const marker = view.getUint16( offset )
        const length = view.getUint16( offset + 2 )

        // APP1 "Exif\0\0" holds a TIFF header with the orientation tag (0x0112)
        if( marker === 0xFFE1 && view.getUint32( offset + 4 ) === 0x45786966 ) {
            const tiff = offset + 10
            const little = view.getUint16( tiff ) === 0x4949
            const ifd = tiff + view.getUint32( tiff + 4, little )
            const entries = view.getUint16( ifd, little )
            for( let index = 0; index < entries; index++ ) {
                const entry = ifd + 2 + index * 12
                if( entry + 10 > view.byteLength ) break
                if( view.getUint16( entry, little ) === 0x0112 ) return view.getUint16( entry + 8, little )
            }
            return 1
        }

        // Start of scan: no metadata past here
        if( marker === 0xFFDA || ( marker & 0xFF00 ) !== 0xFF00 ) return 1
        offset += 2 + length

    }

    return 1

}

/**
 * Scale (width, height) so the long side is at most `max_side`.
 * @returns {{ width: number, height: number, scaled: boolean }}
 */
export const fit_image_size = ( width, height, max_side = MAX_IMAGE_SIDE ) => {
    const long_side = Math.max( width, height )
    if( long_side <= max_side ) return { width, height, scaled: false }
    const scale = max_side / long_side
    return { width: Math.round( width * scale ), height: Math.round( height * scale ), scaled: true }
}

/** Decode any browser-readable image, upright per its EXIF orientation. */
const decode_image = async blob => {

    try {
        return await createImageBitmap( blob, { imageOrientation: `from-image` } )
    } catch {

        // SVG and a few others only decode through an <img>
        const url = URL.createObjectURL( blob )
        try {
            const image = new Image()
            image.src = url
            await image.decode()
            return image
        } finally {
            URL.revokeObjectURL( url )
        }

    }

}

/**
 * Turn a pasted, dropped, or picked file into an image attachment the model
 * runtime can decode. PNG and upright JPEG under 2048 px pass through
 * untouched; everything else is redrawn upright and downscaled, keeping PNG
 * for PNG (screenshots stay crisp) and JPEG q≈0.9 otherwise.
 * @param {File|Blob} file
 * @returns {Promise<{ kind: 'image', mime: string, name: string, data: Blob, width: number, height: number }>}
 */
export const prepare_image = async file => {

    const name = file.name || `image.${ ( file.type || `image/png` ).split( `/` )[ 1 ] }`
    const head = await file.slice( 0, 65_536 ).arrayBuffer()
    const upright = file.type !== `image/jpeg` || read_jpeg_orientation( head ) === 1

    const image = await decode_image( file )
    const natural_width = image.width || image.naturalWidth
    const natural_height = image.height || image.naturalHeight
    const { width, height, scaled } = fit_image_size( natural_width, natural_height )

    if( PASSTHROUGH_MIMES.has( file.type ) && upright && !scaled ) {
        image.close?.()
        return { kind: `image`, mime: file.type, name, data: file, width, height }
    }

    const canvas = document.createElement( `canvas` )
    canvas.width = width
    canvas.height = height
    canvas.getContext( `2d` ).drawImage( image, 0, 0, width, height )
    image.close?.()

    const mime = file.type === `image/png` ? `image/png` : `image/jpeg`
    const data = await new Promise( ( resolve, reject ) => canvas.toBlob(
        blob => blob ? resolve( blob ) : reject( new Error( `Could not read this image` ) ),
        mime,
        0.9,
    ) )

    return { kind: `image`, mime, name, data, width, height }

}


// ─── Persistence ───────────────────────────────────────────────────────────────

/**
 * Attachments → IndexedDB. Images store raw bytes plus their type; some
 * Safari releases refused Blobs inside IndexedDB records, ArrayBuffers always work.
 * @param {Array} [attachments]
 * @returns {Promise<Array|null>}
 */
export const serialize_attachments = async attachments => {

    if( !attachments?.length ) return null

    return Promise.all( attachments.map( async ( { kind, data, ...meta } ) => {
        if( kind !== `image` ) return { kind, ...meta }
        const bytes = data instanceof Blob ? await data.arrayBuffer() : data
        return { kind, ...meta, bytes }
    } ) )

}

/**
 * IndexedDB → attachments with Blobs again.
 * @param {Array|null} [stored]
 * @returns {Array|undefined}
 */
export const deserialize_attachments = stored => {

    if( !stored?.length ) return undefined

    return stored.map( ( { kind, bytes, ...meta } ) => kind === `image`
        ? { kind, ...meta, data: new Blob( [ bytes ], { type: meta.mime } ) }
        : { kind, ...meta } )

}


// ─── Message composition ───────────────────────────────────────────────────────

const escape_attribute = value => `${ value }`.replace( /&/g, `&amp;` ).replace( /"/g, `&quot;` ).replace( /</g, `&lt;` )
const unescape_attribute = value => value.replace( /&lt;/g, `<` ).replace( /&quot;/g, `"` ).replace( /&amp;/g, `&` )

const DOCUMENT_BLOCK = /<document name="([^"]*)">\n?[\s\S]*?\n?<\/document>\n*/g

/**
 * Split stored content into its document blocks and what the user typed.
 * @param {string} content
 * @returns {{ text: string, blocks: string, names: string[] }}
 */
export const split_documents = ( content = `` ) => {

    const names = []
    const blocks = []
    const text = content.replace( DOCUMENT_BLOCK, ( block, name ) => {
        names.push( unescape_attribute( name ) )
        blocks.push( block )
        return ``
    } )

    return { text: text.trim(), blocks: blocks.join( `` ), names }

}

/**
 * Cut text to roughly `max_tokens`, preferring a line or word boundary.
 * @param {string} text
 * @param {number} max_tokens
 * @returns {{ text: string, truncated: boolean }}
 */
export const fit_text_to_tokens = ( text, max_tokens ) => {

    if( estimate_tokens( text ) <= max_tokens ) return { text, truncated: false }

    // Binary search the longest prefix within budget; the estimate is monotone
    let low = 0
    let high = text.length
    while( low < high ) {
        const middle = Math.ceil( ( low + high ) / 2 )
        if( estimate_tokens( text.slice( 0, middle ) ) <= max_tokens ) low = middle
        else high = middle - 1
    }

    const prefix = text.slice( 0, low )
    const line_end = prefix.lastIndexOf( `\n` )
    const boundary = line_end > low * 0.8 ? line_end : prefix.lastIndexOf( ` ` )
    const cut = boundary > low * 0.8 ? prefix.slice( 0, boundary ) : prefix
    return { text: cut.trimEnd(), truncated: true }

}

/**
 * Build the user message: documents inlined into content, cut to fit the
 * token budget, images kept as attachments for the provider.
 * Documents share the budget in order; a document that does not fit whole is
 * cut and marked truncated, one with no room left is cut to nothing.
 *
 * @param {Object} draft
 * @param {string} draft.text - What the user typed
 * @param {Array} [draft.images] - Prepared image attachments
 * @param {Array} [draft.documents] - `{ name, text, pages, empty_pages }`
 * @param {number} [draft.budget_tokens] - Tokens documents may use in total
 * @returns {{ content: string, attachments: Array|undefined }}
 */
export const compose_user_message = ( { text, images = [], documents = [], budget_tokens = Infinity } ) => {

    let remaining = budget_tokens
    const blocks = []
    const document_meta = []

    for( const document of documents ) {

        const fitted = fit_text_to_tokens( document.text, Math.max( remaining, 0 ) )
        remaining -= estimate_tokens( fitted.text )

        const notice = fitted.truncated ? `\n[Document shortened to fit the model's memory]` : ``
        blocks.push( `<document name="${ escape_attribute( document.name ) }">\n${ fitted.text }${ notice }\n</document>\n\n` )
        document_meta.push( {
            kind: `document`,
            name: document.name,
            pages: document.pages,
            chars: fitted.text.length,
            truncated: fitted.truncated,
            empty_pages: document.empty_pages || [],
        } )

    }

    const attachments = [ ...images, ...document_meta ]
    return {
        content: `${ blocks.join( `` ) }${ text.trim() }`.trim(),
        attachments: attachments.length ? attachments : undefined,
    }

}

/**
 * Tokens the conversation already holds, for budgeting new documents.
 * @param {Array} messages
 * @returns {number}
 */
export const estimate_history_tokens = messages => messages.reduce( ( total, { content = ``, attachments } ) => {
    const images = attachments?.filter( ( { kind } ) => kind === `image` ).length || 0
    return total + estimate_tokens( content ) + Math.min( images, MAX_HISTORY_IMAGES ) * IMAGE_MAX_TOKENS + 8
}, 0 )

/**
 * Tokens left for documents in the next message. Reserves room for the reply
 * (up to a quarter of the context) and a safety margin for the template.
 * @param {Object} options
 * @param {number} options.context_size - Loaded context window
 * @param {number} [options.history_tokens] - Tokens the conversation already uses
 * @param {number} [options.max_tokens] - Reply length setting
 * @param {number} [options.image_count] - Images in the draft
 * @returns {number}
 */
export const document_token_budget = ( { context_size, history_tokens = 0, max_tokens = 1024, image_count = 0 } ) => {
    const answer_tokens = Math.min( max_tokens, Math.floor( context_size / 4 ) )
    const safety_tokens = 256
    return Math.max( 0, context_size - history_tokens - answer_tokens - safety_tokens - image_count * IMAGE_MAX_TOKENS )
}


// ─── Provider shape ────────────────────────────────────────────────────────────

/**
 * App messages → wllama chat messages. User turns with images become content
 * parts `[ image…, text ]`; only the newest MAX_HISTORY_IMAGES images are sent.
 * @param {Array<{ role: string, content: string, attachments?: Array }>} messages
 * @returns {Promise<Array>}
 */
export const to_wllama_messages = async messages => {

    // Count images from the end so the newest ones survive
    let images_left = MAX_HISTORY_IMAGES
    const keep = new Set()
    for( const message of [ ...messages ].reverse() ) {
        for( const attachment of [ ...message.attachments || [] ].reverse() ) {
            if( attachment.kind !== `image` || images_left <= 0 ) continue
            keep.add( attachment )
            images_left--
        }
    }

    return Promise.all( messages.map( async ( { role, content, attachments } ) => {

        const images = attachments?.filter( ( { kind } ) => kind === `image` ) || []
        if( role !== `user` || !images.length ) return { role, content }

        const omitted = images.filter( image => !keep.has( image ) ).length
        const parts = await Promise.all( images.filter( image => keep.has( image ) ).map( async ( { data } ) => ( {
            type: `image`,
            data: data instanceof Blob ? await data.arrayBuffer() : data,
        } ) ) )
        const note = omitted ? `[${ omitted } earlier image${ omitted > 1 ? `s` : `` } omitted]\n` : ``

        return { role, content: [ ...parts, { type: `text`, text: `${ note }${ content }` } ] }

    } ) )

}
