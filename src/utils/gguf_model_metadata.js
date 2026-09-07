import { MODEL_CATALOG } from './model_catalog'

export const normalize_label = value => String( value || `` ).trim().toLowerCase()

export const file_size = file => file.size || file.lfs?.size || 0

export const parameter_label = count => {
    if( !count ) return `Custom`
    if( count >= 1_000_000_000 ) return `${ ( count / 1_000_000_000 ).toFixed( 1 ).replace( /\.0$/, `` ) }B`
    if( count >= 1_000_000 ) return `${ Math.round( count / 1_000_000 ) }M`
    return `${ count }`
}

export const category_for_size = size => {
    if( size < 500_000_000 ) return `lightweight`
    if( size < 2_000_000_000 ) return `medium`
    if( size < 10_000_000_000 ) return `heavy`
    return `ultra`
}

export const bpw_for_quantization = quantization => {
    const quant = String( quantization || `` ).toUpperCase()
    if( quant === `F32` ) return 32
    if( quant === `F16` || quant === `BF16` ) return 16
    if( quant.startsWith( `Q8` ) ) return 8.5
    if( quant.startsWith( `Q6` ) ) return 6.5
    if( quant.startsWith( `Q5` ) ) return 5.7
    if( quant.startsWith( `Q4` ) ) return 4.85
    if( quant.startsWith( `Q3` ) || quant.startsWith( `IQ3` ) ) return 3.7
    if( quant.startsWith( `Q2` ) || quant.startsWith( `IQ2` ) ) return 2.7
    if( quant.startsWith( `IQ1` ) ) return 1.8
    return 0
}

export const estimate_bpw_from_file = ( file_size_bytes, parameters ) => {
    if( !file_size_bytes || !parameters ) return 0
    return Math.round(  file_size_bytes * 8 / parameters  * 10 ) / 10
}

export const gguf_parameters = model_data =>
    model_data?.numParameters || model_data?.gguf?.total || 0

export const architecture_profile = ( architecture, parameters = 0 ) => {
    const family = normalize_label( architecture )
    if( !family ) return null

    const profiles = MODEL_CATALOG.filter( model => model.family === family )
    if( !profiles.length ) return null
    if( !parameters ) return profiles.find( model => model.parameters_label === `2B` ) || profiles[ 0 ]

    return profiles.reduce( ( best, model ) => {
        if( !model.parameters ) return best
        if( !best?.parameters ) return model

        const distance = Math.abs( model.parameters - parameters )
        const best_distance = Math.abs( best.parameters - parameters )
        return distance < best_distance ? model : best
    }, profiles[ 0 ] )
}
