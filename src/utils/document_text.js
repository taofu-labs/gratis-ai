/**
 * Document text extraction for chat uploads: PDFs through unpdf (a
 * serverless pdf.js build, loaded on first use) and plain text files as-is.
 *
 * @module document_text
 */

export const TEXT_EXTENSIONS = new Set( [
    `txt`, `md`, `json`, `csv`, `xml`, `html`, `js`, `ts`, `jsx`, `tsx`,
    `py`, `java`, `c`, `cpp`, `h`, `rs`, `go`, `rb`, `sh`, `yaml`, `yml`,
    `toml`, `ini`, `cfg`, `log`, `sql`, `css`, `scss`, `less`, `vue`,
    `svelte`, `php`, `swift`, `kt`, `scala`, `lua`, `r`, `hs`, `ex`,
    `dockerfile`, `makefile`, `bat`, `ps1`, `tex`, `rst`, `srt`, `tsv`,
] )

// Reading limits only; what reaches the model is bounded by the context budget
export const MAX_TEXT_FILE_BYTES = 5_000_000
export const MAX_PDF_BYTES = 50_000_000

/** Lowercased extension, or the whole lowercased name for e.g. `Makefile`. */
export const file_extension = name => name.split( `.` ).pop()?.toLowerCase() || ``

export const is_pdf_file = file => file?.type === `application/pdf` || file_extension( file?.name || `` ) === `pdf`
export const is_text_file = file => TEXT_EXTENSIONS.has( file_extension( file?.name || `` ) ) || /^text\//.test( file?.type || `` )

/** Error with a stable `code` the UI maps to translated copy. */
const document_error = ( code, message ) => Object.assign( new Error( message ), { code } )

/**
 * Rough token count without a tokenizer. Latin text averages ~4 characters
 * per token; CJK and most other non-ASCII scripts are closer to one token per
 * character, so those count one each. Errs on the high side, which is safe.
 * @param {string} text
 * @returns {number}
 */
export const estimate_tokens = ( text = `` ) => {
    let non_ascii = 0
    for( let index = 0; index < text.length; index++ ) {
        if( text.charCodeAt( index ) > 0x7F ) non_ascii++
    }
    return Math.ceil( ( text.length - non_ascii ) / 4 + non_ascii )
}

/**
 * Join per-page text, numbering pages so the model can cite them, and report
 * pages that have no text layer (scans, photos).
 * @param {string[]} pages
 * @returns {{ text: string, empty_pages: number[] }}
 */
export const join_pdf_pages = pages => {

    const empty_pages = []
    const parts = []

    pages.forEach( ( page_text, index ) => {
        const clean = page_text.replace( /[ \t]+\n/g, `\n` ).replace( /\n{3,}/g, `\n\n` ).trim()
        if( !clean ) return empty_pages.push( index + 1 )
        parts.push( pages.length > 1 ? `[Page ${ index + 1 }]\n${ clean }` : clean )
    } )

    return { text: parts.join( `\n\n` ), empty_pages }

}

/**
 * Extract the text of an uploaded document.
 * Throws with `code`: `too_large`, `unsupported`, `image_only` (PDF without
 * any text layer), or `unreadable`.
 * @param {File} file
 * @returns {Promise<{ name: string, text: string, pages: number|null, empty_pages: number[] }>}
 */
export const read_document = async file => {

    const { name } = file

    if( is_pdf_file( file ) ) {

        if( file.size > MAX_PDF_BYTES ) throw document_error( `too_large`, `PDF is too large` )

        let pages
        try {
            const { getDocumentProxy, extractText } = await import( 'unpdf' )
            const pdf = await getDocumentProxy( new Uint8Array( await file.arrayBuffer() ) )
            const { text } = await extractText( pdf, { mergePages: false } )
            pages = text
            await pdf.destroy?.()
        } catch ( error ) {
            throw document_error( `unreadable`, error?.message || `Could not read PDF` )
        }

        const { text, empty_pages } = join_pdf_pages( pages )
        if( !text ) throw document_error( `image_only`, `PDF has no text layer` )
        return { name, text, pages: pages.length, empty_pages }

    }

    if( is_text_file( file ) ) {
        if( file.size > MAX_TEXT_FILE_BYTES ) throw document_error( `too_large`, `File is too large` )
        return { name, text: await file.text(), pages: null, empty_pages: [] }
    }

    throw document_error( `unsupported`, `Unsupported file type` )

}
