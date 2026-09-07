import { get_hf_headers, hf_status_message, with_hf_headers } from './hf_auth'
import { extract_quantization } from './hf_url_parser'
import {
    architecture_profile,
    bpw_for_quantization,
    category_for_size,
    estimate_bpw_from_file,
    file_size,
    gguf_parameters,
    normalize_label,
    parameter_label,
} from './gguf_model_metadata'

const HF_BASE_URL = import.meta.env.VITE_HF_BASE_URL || `https://huggingface.co`
const TPN_OWNER = `tpnlabs`
const TPN_COLLECTION_TITLE = /^TPN-\d+$/i

const strip_html = value => String( value || `` ).replace( /<[^>]*>/g, `` )

const slugify = value => normalize_label( value )
    .replace( /\.gguf$/i, `` )
    .replace( /[^a-z0-9]+/g, `-` )
    .replace( /^-|-$/g, `` )

const fetch_json = async ( url, fetch_impl, headers ) => {
    const response = await fetch_impl( url, with_hf_headers( {}, headers ) )
    if( !response.ok ) throw new Error( hf_status_message( response.status ) )
    return response.json()
}

const collection_id = collection => normalize_label( collection.title )

const is_tpn_collection = collection => TPN_COLLECTION_TITLE.test( collection.title || `` )

const note_text = item => normalize_label( item.note?.text || strip_html( item.note?.html ) )

const is_winner_item = ( item, competition_id ) => {
    const note = note_text( item )
    return item.type === `model` && ( note === `winner` || note === `${ competition_id }-winner` )
}

const build_winner_variant = ( { collection, item, model_data, file } ) => {
    const competition = collection.title
    const competition_slug = collection_id( collection )
    const quantization = extract_quantization( file.rfilename ) || `GGUF`
    const size = file_size( file ) || model_data.gguf?.totalFileSize || 0
    const architecture = model_data.gguf?.architecture || `custom`
    const parameters = item.numParameters || model_data.numParameters || gguf_parameters( model_data )
    const profile = architecture_profile( architecture, parameters )
    const author = item.author || item.id.split( `/` )[ 0 ]

    return {
        id: `${ competition_slug }-winner-${ slugify( file.rfilename ) }`,
        name: `${ competition } Winner`,
        description: `Winning model by ${ author }.`,
        family: architecture,
        parameters: parameters || profile?.parameters || 0,
        parameters_label: parameter_label( parameters || profile?.parameters ),
        quantization,
        bpw: bpw_for_quantization( quantization ) || estimate_bpw_from_file( size, parameters ),
        file_size_bytes: size,
        context_length: model_data.gguf?.context_length || profile?.context_length || 4096,
        layers: profile?.layers,
        block_count: profile?.block_count,
        kv_heads: profile?.kv_heads,
        head_dim: profile?.head_dim,
        hugging_face_repo: item.id,
        file_name: file.rfilename,
        reasoning: profile?.reasoning || false,
        reasoning_enabled: profile?.reasoning_enabled || false,
        benchmarks: null,
        license: model_data.cardData?.license || profile?.license || `unknown`,
        category: category_for_size( size ),
        is_tpn_winner: true,
        tpn_competition: competition,
        tpn_author: author,
        tpn_collection_url: collection.shareUrl || `${ HF_BASE_URL }/collections/${ collection.slug }`,
    }
}

/**
 * Resolve every public TPN collection winner into downloadable GGUF variants.
 * Collections provide lineage; only items marked as winner become selectable.
 *
 * @param {Object} [options]
 * @param {typeof fetch} [options.fetch_impl]
 * @param {Record<string, string>} [options.headers]
 * @returns {Promise<import('./model_catalog').ModelDefinition[]>}
 */
export const resolve_tpn_winner_models = async ( {
    fetch_impl = fetch,
    headers = get_hf_headers(),
} = {} ) => {
    const collections = await fetch_json(
        `${ HF_BASE_URL }/api/collections?owner=${ TPN_OWNER }&limit=50`,
        fetch_impl,
        headers,
    )

    const tpn_collections = collections
        .filter( is_tpn_collection )
        .sort( ( a, b ) => collection_id( b ).localeCompare( collection_id( a ) ) )

    const variants = []

    for( const collection of tpn_collections ) {
        const winner = collection.items?.find( item => is_winner_item( item, collection_id( collection ) ) )
        if( !winner?.id ) continue

        const model_data = await fetch_json(
            `${ HF_BASE_URL }/api/models/${ winner.id }?blobs=false`,
            fetch_impl,
            headers,
        )

        const gguf_files = ( model_data.siblings || [] )
            .filter( file => file.rfilename?.toLowerCase().endsWith( `.gguf` ) )
            .sort( ( a, b ) => file_size( a ) - file_size( b ) || a.rfilename.localeCompare( b.rfilename ) )

        for( const file of gguf_files ) {
            variants.push( build_winner_variant( { collection, item: winner, model_data, file } ) )
        }
    }

    return variants
}
