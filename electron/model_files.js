/**
 * Model file helpers for the Electron models directory
 */

import fs from 'fs'

/**
 * On-disk name for a vision projector. Hugging Face repos all call theirs
 * `mmproj-F16.gguf`, so prefix the model's own file stem to keep them apart.
 * @param {string} model_file_name - e.g. `Qwen3.5-2B-Q4_K_M.gguf`
 * @param {string} mmproj_file_name - e.g. `mmproj-F16.gguf`
 * @returns {string} e.g. `Qwen3.5-2B-Q4_K_M.mmproj-F16.gguf`
 */
export const mmproj_local_name = ( model_file_name, mmproj_file_name ) => {
    const stem = model_file_name.replace( /\.gguf$/i, `` )
    const base = mmproj_file_name.split( `/` ).pop()
    return `${ stem }.${ base }`
}

/**
 * Check the 4-byte GGUF magic — catches HTML error pages and truncated junk
 * @param {string} file_path
 * @returns {boolean}
 */
export const has_gguf_magic = ( file_path ) => {

    let fd
    try {
        fd = fs.openSync( file_path, `r` )
        const magic = Buffer.alloc( 4 )
        fs.readSync( fd, magic, 0, 4, 0 )
        return magic.toString( `latin1` ) === `GGUF`
    } catch {
        return false
    } finally {
        if( fd !== undefined ) fs.closeSync( fd )
    }

}

/**
 * Ask Hugging Face for a file's SHA-256 without downloading it. The resolve
 * URL answers with a redirect whose `x-linked-etag` is the LFS/Xet digest.
 * @param {string} url - Hugging Face resolve URL
 * @param {Object} [request_options] - fetch options (headers, signal)
 * @returns {Promise<string|null>} Hex digest, or null when unknown
 */
export const lookup_sha256 = async ( url, request_options = {} ) => {

    try {
        const response = await fetch( url, { ...request_options, method: `HEAD`, redirect: `manual` } )
        const etag = response.headers.get( `x-linked-etag` ) || response.headers.get( `etag` ) || ``
        const hex = etag.replace( /^W\//, `` ).replace( /[^0-9a-f]/gi, `` ).toLowerCase()
        return /^[0-9a-f]{64}$/.test( hex ) ? hex : null
    } catch {
        return null
    }

}
