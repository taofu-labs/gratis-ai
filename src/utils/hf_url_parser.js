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
 * Extract parameter count label from a model name or repo name (e.g. "Mistral-7B" → "7B")
 * @param {string} name
 * @returns {string}
 */
const extract_parameters = ( name ) => {
    const match = name.match( /(\d+(?:\.\d+)?x?\d*(?:\.\d+)?[BbMm])\b/ )
    return match ? match[ 1 ].toUpperCase() : `Custom`
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
 * Estimate model tier from file size
 * @param {number} file_size_bytes
 * @returns {'lightweight' | 'medium' | 'heavy' | 'ultra'}
 */
const estimate_category = ( file_size_bytes ) => {
    if( file_size_bytes < 500_000_000 ) return `lightweight`
    if( file_size_bytes < 2_000_000_000 ) return `medium`
    if( file_size_bytes < 10_000_000_000 ) return `heavy`
    return `ultra`
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
 * @returns {import('./model_catalog').ModelDefinition}
 */
const build_model_def = ( repo, file_name, file_size_bytes ) => ( {
    id: generate_model_id( repo, file_name ),
    category: estimate_category( file_size_bytes ),
    name: derive_model_name( repo ),
    description: `Custom model from ${ repo }`,
    hugging_face_repo: repo,
    file_name,
    file_size_bytes,
    context_length: 4096,
    parameters_label: extract_parameters( repo ),
    quantization: extract_quantization( file_name ) || `unknown`,
    is_custom: true,
} )

/**
 * Resolve a parsed HF URL to a full model definition by querying the HF API.
 * Fetches repo file listing, finds the matching GGUF file, and returns a complete
 * model definition ready for download.
 *
 * @param {{ repo: string, file_name: string|null, quantization: string|null }} parsed
 * @returns {Promise<import('./model_catalog').ModelDefinition>}
 * @throws {Error} If repo not found, no GGUF files, or no matching quantization
 */
export const resolve_hf_model = async ( parsed ) => {

    const { repo, file_name: direct_file, quantization } = parsed

    // Direct file link — just need to verify it exists and get its size
    if( direct_file ) {
        const url = `${ HF_BASE_URL }/${ repo }/resolve/main/${ direct_file }`
        const head = await fetch( url, { method: `HEAD` } )
        if( !head.ok ) throw new Error( `File not found: ${ direct_file }` )

        const size = parseInt( head.headers.get( `content-length` ) ) || 0
        return build_model_def( repo, direct_file, size )
    }

    // Query HF API for repo file listing
    const api_url = `${ HF_BASE_URL }/api/models/${ repo }`
    const response = await fetch( api_url )

    if( !response.ok ) {
        if( response.status === 404 ) throw new Error( `Repository not found: ${ repo }` )
        throw new Error( `HuggingFace API error: ${ response.status }` )
    }

    const data = await response.json()
    const siblings = data.siblings || []

    // Filter to GGUF files only
    const gguf_files = siblings.filter( ( f ) => f.rfilename?.endsWith( `.gguf` ) )
    if( !gguf_files.length ) throw new Error( `No GGUF files found in ${ repo }` )

    // Find the target file — match by quantization hint, or pick a sensible default
    let target_file

    if( quantization ) {
        const quant_lower = quantization.toLowerCase()
        target_file = gguf_files.find( ( f ) => f.rfilename.toLowerCase().includes( quant_lower ) )
        if( !target_file ) throw new Error( `No GGUF file matching "${ quantization }" in ${ repo }` )
    } else {
        // Prefer Q4_K_M as a reasonable default, fall back to first file
        target_file = gguf_files.find( ( f ) => f.rfilename.includes( `Q4_K_M` ) ) || gguf_files[ 0 ]
    }

    // Siblings may not include file size — fetch via HEAD if needed
    let file_size = target_file.size || 0
    if( !file_size ) {
        const head_url = `${ HF_BASE_URL }/${ repo }/resolve/main/${ target_file.rfilename }`
        const head = await fetch( head_url, { method: `HEAD` } )
        file_size = parseInt( head.headers.get( `content-length` ) ) || 0
    }

    return build_model_def( repo, target_file.rfilename, file_size )

}
