const HF_BASE_URL = import.meta.env.VITE_HF_BASE_URL || `https://huggingface.co`

/**
 * Extract quantization label from a GGUF filename (e.g. "model.Q4_K_M.gguf" → "Q4_K_M")
 * @param {string} file_name
 * @returns {string|null}
 */
export const extract_quantization = ( file_name ) => {
    const match = file_name.match( /[._-]((?:UD-)?(?:I?Q\d[\w_]*|BF16|F(?:16|32)))/i )
    return match ? match[ 1 ] : null
}

const normalize_quantization = ( quantization ) =>
    ( quantization || `` ).toUpperCase().replace( /[-.]/g, `_` )

const quantization_rank = ( quantization ) => {

    const quant = normalize_quantization( quantization )

    if( !quant ) return 100
    if( quant.includes( `Q4_K_M` ) ) return 0
    if( quant.includes( `Q4_K_XL` ) ) return 1
    if( quant.includes( `Q4_K_S` ) ) return 2
    if( quant.includes( `Q4_0` ) ) return 3
    if( quant.includes( `IQ4` ) ) return 4
    if( quant.includes( `Q5` ) ) return 10
    if( quant.includes( `Q3` ) ) return 20
    if( quant.includes( `IQ3` ) ) return 25
    if( quant.includes( `Q2` ) ) return 30
    if( quant.includes( `IQ2` ) ) return 35
    if( quant.includes( `Q6` ) ) return 40
    if( quant.includes( `Q8` ) ) return 50
    if( quant.includes( `BF16` ) || quant.includes( `F16` ) || quant.includes( `F32` ) ) return 60
    if( quant.includes( `IQ1` ) || quant.includes( `Q1` ) ) return 90

    return 80

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

const resolve_file_size = async ( repo, file ) => {

    if( file.size ) return file.size

    try {
        const head_url = `${ HF_BASE_URL }/${ repo }/resolve/main/${ file.rfilename }`
        const head = await fetch( head_url, { method: `HEAD` } )
        return parseInt( head.headers.get( `content-length` ) ) || 0
    } catch {
        return 0
    }

}

/**
 * Resolve a parsed HF URL to available GGUF model definitions by querying the HF API.
 * Direct file links return one option. Repo links return all GGUF options, sorted
 * toward practical 4-bit defaults so we never silently choose a 1-bit quant.
 *
 * @param {{ repo: string, file_name: string|null, quantization: string|null }} parsed
 * @returns {Promise<import('./model_catalog').ModelDefinition[]>}
 * @throws {Error} If repo not found or no GGUF files exist
 */
export const resolve_hf_models = async ( parsed ) => {

    const { repo, file_name: direct_file, quantization } = parsed

    // Direct file link — just need to verify it exists and get its size
    if( direct_file ) {
        const url = `${ HF_BASE_URL }/${ repo }/resolve/main/${ direct_file }`
        const head = await fetch( url, { method: `HEAD` } )
        if( !head.ok ) throw new Error( `File not found: ${ direct_file }` )

        const size = parseInt( head.headers.get( `content-length` ) ) || 0
        return [ build_model_def( repo, direct_file, size ) ]
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

    const quant_lower = quantization?.toLowerCase()

    const models = ( await Promise.all(
        gguf_files.map( async file => build_model_def( repo, file.rfilename, await resolve_file_size( repo, file ) ) )
    ) )
        .sort( ( a, b ) => {

            if( quant_lower ) {
                const a_matches = a.file_name.toLowerCase().includes( quant_lower ) ? 1 : 0
                const b_matches = b.file_name.toLowerCase().includes( quant_lower ) ? 1 : 0
                if( a_matches !== b_matches ) return b_matches - a_matches
            }

            return quantization_rank( a.quantization ) - quantization_rank( b.quantization )
                || a.file_size_bytes - b.file_size_bytes
                || a.file_name.localeCompare( b.file_name )

        } )

    if( quant_lower && !models.some( model => model.file_name.toLowerCase().includes( quant_lower ) ) ) {
        throw new Error( `No GGUF file matching "${ quantization }" in ${ repo }` )
    }

    return models

}

/**
 * Resolve a parsed HF URL to a single preferred model definition.
 * @param {{ repo: string, file_name: string|null, quantization: string|null }} parsed
 * @returns {Promise<import('./model_catalog').ModelDefinition>}
 */
export const resolve_hf_model = async ( parsed ) => {
    const models = await resolve_hf_models( parsed )
    return models[ 0 ]
}
