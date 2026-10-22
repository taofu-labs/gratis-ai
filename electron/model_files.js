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
