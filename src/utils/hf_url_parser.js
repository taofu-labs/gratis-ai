import { get_hf_headers, hf_status_message, with_hf_headers } from './hf_auth'
import {
    architecture_profile,
    bpw_for_quantization,
    category_for_size,
    estimate_bpw_from_file,
    file_size,
    gguf_parameters,
    parameter_label,
} from './gguf_model_metadata'

const HF_BASE_URL = import.meta.env.VITE_HF_BASE_URL || `https://huggingface.co`

/**
 * Build the exact download URL used by Wllama and network measurement.
 * @param {string} repo
 * @param {string} file_name
 * @returns {string}
 */
export const build_download_url = ( repo, file_name ) =>
    `${ HF_BASE_URL }/${ repo }/resolve/main/${ file_name }`

/**
 * Extract quantization label from a GGUF filename (e.g. "model.Q4_K_M.gguf" → "Q4_K_M")
 * @param {string} file_name
 * @returns {string|null}
 */
export const extract_quantization = ( file_name ) => {
    const match = file_name.match( /[._-]((?:I?Q\d[\w_]*|F(?:16|32)))/i )
    return match ? match[ 1 ] : null
}

/**
 * Parse a HuggingFace URL or shorthand into repo, optional file, and quantization hint.
 *
 * Supported formats:
 *   - hf.co/org/repo:quant
 *   - https://huggingface.co/org/repo:quant
 *   - https://huggingface.co/org/repo/resolve/main/file.gguf
 *   - org/repo:quant
 *   - org/repo
 *
 * @param {string} input - Raw user input (URL or shorthand)
 * @returns {{ repo: string, file_name: string|null, quantization: string|null } | null}
 */
export const parse_hf_url = ( input ) => {

    const trimmed = input.trim()
    if( !trimmed ) return null

    // Strip protocol and known HF domains
    let path = trimmed
        .replace( /^https?:\/\//, `` )
        .replace( /^(huggingface\.co|hf\.co)\//, `` )

    // Direct file link: org/repo/resolve/branch/file.gguf
    const resolve_match = path.match( /^([^/]+\/[^/]+)\/resolve\/[^/]+\/(.+\.gguf)$/i )
    if( resolve_match ) {
        return {
            repo: resolve_match[ 1 ],
            file_name: resolve_match[ 2 ],
            quantization: extract_quantization( resolve_match[ 2 ] ),
        }
    }

    // Split repo:quant if colon is present
    const colon_index = path.indexOf( `:` )
    const repo_part = colon_index >= 0 ? path.slice( 0, colon_index ) : path
    const quant_hint = colon_index >= 0 ? path.slice( colon_index + 1 ).trim() : null

    // Validate repo format — must have at least org/name
    const parts = repo_part.split( `/` )
    if( parts.length < 2 || !parts[ 0 ] || !parts[ 1 ] ) return null

    return {
        repo: `${ parts[ 0 ] }/${ parts[ 1 ] }`,
        file_name: null,
        quantization: quant_hint || null,
    }

}

/**
 * Derive a human-readable model name from a HF repo path
 * @param {string} repo - HF repo (org/name)
 * @returns {string}
 */
const derive_model_name = ( repo ) => {
    const repo_name = repo.split( `/` )[ 1 ] || repo
    return repo_name
        .replace( /-GGUF$/i, `` )
        .replace( /[-_]/g, ` ` )
}

/**
 * Generate a stable model ID from repo and filename
 * @param {string} repo
 * @param {string} file_name
 * @returns {string}
 */
const generate_model_id = ( repo, file_name ) => {
    const repo_name = repo.split( `/` )[ 1 ] || repo
    const base = repo_name.replace( /-GGUF$/i, `` ).toLowerCase()
    const quant = extract_quantization( file_name )
    return quant ? `custom-${ base }-${ quant.toLowerCase() }` : `custom-${ base }`
}

/**
 * Build a model definition from resolved HF data
 * @param {string} repo
 * @param {string} file_name
 * @param {number} file_size_bytes
 * @param {Object} [model_data]
 * @returns {import('./model_catalog').ModelDefinition}
 */
const build_model_def = ( repo, file_name, file_size_bytes, model_data = {} ) => {
    const architecture = model_data.gguf?.architecture || `custom`
    const parameters = gguf_parameters( model_data )
    const profile = architecture_profile( architecture, parameters )
    const quantization = extract_quantization( file_name ) || `GGUF`
    const bpw = bpw_for_quantization( quantization ) || estimate_bpw_from_file( file_size_bytes, parameters )

    return {
        id: generate_model_id( repo, file_name ),
        category: category_for_size( file_size_bytes ),
        name: derive_model_name( repo ),
        description: `Custom GGUF from ${ repo }`,
        family: architecture,
        parameters: parameters || profile?.parameters || 0,
        parameters_label: parameter_label( parameters || profile?.parameters ),
        quantization,
        bpw,
        file_size_bytes,
        context_length: model_data.gguf?.context_length || profile?.context_length || 4096,
        layers: profile?.layers,
        block_count: profile?.block_count,
        kv_heads: profile?.kv_heads,
        head_dim: profile?.head_dim,
        sliding_kv: profile?.sliding_kv,
        hugging_face_repo: repo,
        file_name,
        reasoning: profile?.reasoning || false,
        reasoning_enabled: profile?.reasoning_enabled || false,
        license: model_data.cardData?.license || profile?.license || `unknown`,
        is_custom: true,
    }
}

const fetch_model_data = async ( repo, fetch_impl, headers ) => {
    const api_url = `${ HF_BASE_URL }/api/models/${ repo }?blobs=true`
    const response = await fetch_impl( api_url, with_hf_headers( {}, headers ) )

    if( !response.ok ) {
        if( response.status === 404 ) throw new Error( `Repository not found: ${ repo }` )
        throw new Error( hf_status_message( response.status ) )
    }

    return response.json()
}

const resolve_file_size = async ( repo, file_name, target_file, model_data, fetch_impl, headers ) => {
    const known_size = file_size( target_file ) || model_data.gguf?.totalFileSize || 0
    if( known_size ) return known_size

    const head_url = `${ HF_BASE_URL }/${ repo }/resolve/main/${ file_name }`
    const head = await fetch_impl( head_url, with_hf_headers( { method: `HEAD` }, headers ) )
    if( !head.ok ) throw new Error( hf_status_message( head.status ) )
    return parseInt( head.headers.get( `content-length` ) ) || 0
}

/**
 * Resolve a parsed HF URL to a full model definition by querying the HF API.
 * Fetches repo file listing, finds the matching GGUF file, and returns a complete
 * model definition ready for download.
 *
 * @param {{ repo: string, file_name: string|null, quantization: string|null }} parsed
 * @param {Object} [options]
 * @param {typeof fetch} [options.fetch_impl]
 * @param {Record<string, string>} [options.headers]
 * @returns {Promise<import('./model_catalog').ModelDefinition>}
 * @throws {Error} If repo not found, no GGUF files, or no matching quantization
 */
export const resolve_hf_model = async ( parsed, {
    fetch_impl = fetch,
    headers = get_hf_headers(),
} = {} ) => {

    const { repo, file_name: direct_file, quantization } = parsed

    const data = await fetch_model_data( repo, fetch_impl, headers )
    const siblings = data.siblings || []

    // Filter to GGUF files only
    const gguf_files = siblings.filter( ( f ) => f.rfilename?.endsWith( `.gguf` ) )
    if( !gguf_files.length ) throw new Error( `No GGUF files found in ${ repo }` )

    // Find the target file — match by quantization hint, or pick a sensible default
    let target_file

    if( direct_file ) {
        target_file = gguf_files.find( ( f ) => f.rfilename === direct_file )
        if( !target_file ) throw new Error( `GGUF file not found: ${ direct_file }` )
    } else if( quantization ) {
        const quant_lower = quantization.toLowerCase()
        target_file = gguf_files.find( ( f ) => f.rfilename.toLowerCase().includes( quant_lower ) )
        if( !target_file ) throw new Error( `No GGUF file matching "${ quantization }" in ${ repo }` )
    } else {
        // Prefer Q4_K_M as a reasonable default, fall back to first file
        target_file = gguf_files.find( ( f ) => f.rfilename.includes( `Q4_K_M` ) ) || gguf_files[ 0 ]
    }

    const size = await resolve_file_size( repo, target_file.rfilename, target_file, data, fetch_impl, headers )

    return build_model_def( repo, target_file.rfilename, size, data )

}
