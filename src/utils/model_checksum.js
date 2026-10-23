import { fileDownloadInfo } from '@huggingface/hub'
import { createSHA256 } from 'hash-wasm'
import { log } from 'mentie'
import { get_hf_token } from './hf_auth'

const HF_BASE_URL = import.meta.env.VITE_HF_BASE_URL || `https://huggingface.co`
const SHA256_PATTERN = /^[0-9a-f]{64}$/

/**
 * A corrupt model file. Size and GGUF magic can both look right while the
 * weights are wrong, which loads fine and then generates garbage.
 */
export class ChecksumError extends Error {
    constructor( message = `The model file is corrupted (checksum mismatch). Please download it again.` ) {
        super( message )
        this.name = `ChecksumError`
    }
}

/**
 * Normalise an etag into a SHA-256 hex digest. Hugging Face LFS/Xet files use
 * the file's SHA-256 as etag; small git files use a SHA-1 and yield null.
 * @param {string} [value] - Raw or cleaned etag
 * @returns {string|null}
 */
export const as_sha256 = value => {
    const hex = String( value || `` ).replace( /^W\//, `` ).replace( /[^0-9a-f]/gi, `` ).toLowerCase()
    return SHA256_PATTERN.test( hex ) ? hex : null
}

/**
 * Ask Hugging Face for a file's SHA-256. Null when offline or unknown, so
 * callers can skip verification rather than block the user.
 * @param {{ hugging_face_repo: string, file_name: string }} source
 * @returns {Promise<string|null>}
 */
export const lookup_sha256 = async ( { hugging_face_repo, file_name } ) => {

    if( !hugging_face_repo || !file_name ) return null

    try {
        const access_token = get_hf_token() || undefined
        const info = await fileDownloadInfo( {
            repo: hugging_face_repo,
            path: file_name,
            revision: `main`,
            hubUrl: HF_BASE_URL,
            ... access_token ? { accessToken: access_token } : {},
        } )
        return as_sha256( info?.etag )
    } catch ( error ) {
        log.warn( `[checksum] Could not look up SHA-256 for ${ file_name }:`, error?.message )
        return null
    }

}

/**
 * Stream blobs through SHA-256 in order, as if they were one file.
 * @param {Blob[]} files
 * @param {Object} [options]
 * @param {( progress: { hashed: number, total: number } ) => void} [options.on_progress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<string>} Hex digest
 */
export const sha256_of_files = async ( files, { on_progress, signal } = {} ) => {

    const hasher = await createSHA256()
    hasher.init()

    const total = files.reduce( ( sum, file ) => sum + file.size, 0 )
    let hashed = 0
    let last_reported_at = 0

    for( const file of files ) {

        const reader = file.stream().getReader()

        try {
            while( true ) {
                if( signal?.aborted ) throw Object.assign( new Error( `Verification aborted` ), { name: `AbortError` } )

                const { done, value } = await reader.read()
                if( done ) break

                hasher.update( value )
                hashed += value.byteLength

                // Throttled: a multi-GB file yields tens of thousands of chunks
                const now = performance.now()
                if( now - last_reported_at > 100 ) {
                    last_reported_at = now
                    on_progress?.( { hashed, total } )
                }
            }
        } finally {
            reader.releaseLock()
        }

    }

    on_progress?.( { hashed, total } )
    return hasher.digest( `hex` )

}

/**
 * Hash `files` and compare against `expected`. Throws ChecksumError on a
 * mismatch; does nothing when no expected digest is known.
 * @param {Blob[]} files
 * @param {string|null} expected - SHA-256 hex
 * @param {Object} [options] - See sha256_of_files
 * @returns {Promise<boolean>} True when the digest was checked and matched
 */
export const verify_sha256 = async ( files, expected, options ) => {

    if( !expected ) return false

    const started_at = performance.now()
    const actual = await sha256_of_files( files, options )
    const seconds = ( ( performance.now() - started_at ) / 1000 ).toFixed( 1 )

    if( actual !== expected ) {
        log.warn( `[checksum] SHA-256 mismatch: expected ${ expected }, got ${ actual }` )
        throw new ChecksumError()
    }

    log.info( `[checksum] SHA-256 verified in ${ seconds }s` )
    return true

}
