import { storage_key } from './branding'

export const HF_TOKEN_SETTING = `hf_token`

export const sanitize_hf_token = value => String( value || `` ).trim()

export const get_hf_token = ( storage = globalThis.localStorage ) => {
    try {
        return sanitize_hf_token( storage?.getItem( storage_key( HF_TOKEN_SETTING ) ) )
    } catch {
        return ``
    }
}

export const get_hf_headers = ( token = get_hf_token() ) => {
    const clean_token = sanitize_hf_token( token )
    return clean_token ? { Authorization: `Bearer ${ clean_token }` } : {}
}

export const has_hf_token = ( storage = globalThis.localStorage ) =>
    Boolean( get_hf_token( storage ) )

export const with_hf_headers = ( options = {}, headers = get_hf_headers() ) => {
    const auth_headers = headers || {}
    if( !Object.keys( auth_headers ).length ) return options
    return {
        ...options,
        headers: {
            ...auth_headers,
            ... options.headers || {} ,
        },
    }
}

export const hf_status_message = ( status ) => {
    if( status === 401 || status === 403 ) {
        return `Hugging Face rejected the token or this account does not have access to the model. Check the read token in Settings > Models.`
    }
    if( status === 404 ) return `Hugging Face could not find that model or GGUF file.`
    if( status === 429 ) {
        return `Hugging Face is throttling this download. Add a read token in Settings > Models or retry after the limit resets.`
    }
    return `Hugging Face returned ${ status }.`
}

const status_from_error = error => {
    const status = error?.status || error?.statusCode || error?.response?.status
    if( Number.isFinite( Number( status ) ) ) return Number( status )

    const message = String( error?.message || error || `` )
    const match = message.match( /\b(401|403|404|429)\b/ )
    return match ? Number( match[ 1 ] ) : null
}

export const normalize_hf_error = error => {
    const status = status_from_error( error )
    if( !status ) return error instanceof Error ? error : new Error( String( error ) )

    const normalized = new Error( hf_status_message( status ) )
    normalized.status = status
    normalized.cause = error
    return normalized
}
