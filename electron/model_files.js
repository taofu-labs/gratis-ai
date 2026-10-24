/**
 * Model file helpers for the Electron models directory
 */

import fs from 'fs'

// Shared with the mobile apps, which store projectors the same way
export { mmproj_local_name } from '../src/utils/llama_server_protocol.js'

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
