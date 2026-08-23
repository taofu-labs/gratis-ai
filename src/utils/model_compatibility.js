export const BROWSER_RECOMMENDED_GGUF_FILE_BYTES = 2_000_000_000

/**
 * Return a user-facing reason when the browser runtime cannot load a GGUF file.
 * @returns {string|null}
 */
export const get_browser_model_incompatibility = () => {

    return null

}

export const get_browser_model_warning = ( model ) => {

    const size_bytes = model?.file_size_bytes || model?.blob?.size || 0

    if( size_bytes > BROWSER_RECOMMENDED_GGUF_FILE_BYTES ) {
        return `Large browser models need a 64-bit Chromium browser with Memory64 support and enough free RAM. If loading fails, lower context or pick a smaller quantization.`
    }

    return null

}
