import { storage_key } from './branding'

const MIB = 1024 ** 2
const PROBE_TTL_MS = 15 * 60_000
const DOWNLOAD_TTL_MS = 24 * 60 * 60_000
const MAX_SAMPLES_PER_SOURCE = 5

const host_from_url = url => {
    try {
        return new URL( url, globalThis.location?.href ).host
    } catch {
        return `unknown`
    }
}

const sample_key = url => storage_key( `network_speed:${ host_from_url( url ) }` )

/**
 * Describe the current network class without relying on its optimistic
 * downlink value as the measurement itself.
 *
 * @param {NetworkInformation|Object|null} connection
 * @returns {string}
 */
export const connection_fingerprint = ( connection = globalThis.navigator?.connection ) => [
    connection?.type || `unknown`,
    connection?.effectiveType || `unknown`,
    connection?.saveData ? `save-data` : `normal-data`,
].join( `:` )

const read_samples = ( url, storage ) => {
    try {
        const parsed = JSON.parse( storage?.getItem( sample_key( url ) ) || `[]` )
        return Array.isArray( parsed ) ? parsed : []
    } catch {
        return []
    }
}

/**
 * Persist one bounded, host-scoped throughput observation.
 *
 * @param {string} url
 * @param {number} bps
 * @param {'probe'|'download'} source
 * @param {Object} [options]
 */
export const record_speed_sample = ( url, bps, source, {
    storage = globalThis.localStorage,
    now = Date.now(),
    fingerprint = connection_fingerprint(),
} = {} ) => {

    if( !url || !Number.isFinite( bps ) || bps <= 0 || !storage ) return

    const existing = read_samples( url, storage )
        .filter( sample => sample?.source === `probe` || sample?.source === `download` )

    const next_source = [
        ...existing.filter( sample => sample.source === source ),
        { bps, source, at: now, fingerprint },
    ].slice( -MAX_SAMPLES_PER_SOURCE )

    const other_source = existing
        .filter( sample => sample.source !== source )
        .slice( -MAX_SAMPLES_PER_SOURCE )

    try {
        storage.setItem( sample_key( url ), JSON.stringify( [ ...other_source, ...next_source ] ) )
    } catch {
        // Private mode and full storage must not affect model selection.
    }

}

const conservative_speed = samples => {
    const ordered = samples.map( sample => sample.bps ).sort( ( a, b ) => a - b )
    if( !ordered.length ) return null
    return Math.floor( ordered[ Math.floor( ( ordered.length - 1 ) * 0.25 ) ] * 0.9 )
}

/**
 * Read the best fresh estimate, preferring actual model-download history.
 *
 * @param {string} url
 * @param {Object} [options]
 * @returns {{bps: number, source: 'download'|'probe'}|null}
 */
export const get_speed_estimate = ( url, {
    storage = globalThis.localStorage,
    now = Date.now(),
    fingerprint = connection_fingerprint(),
} = {} ) => {

    const fresh = read_samples( url, storage ).filter( sample => {
        const ttl = sample.source === `download` ? DOWNLOAD_TTL_MS : PROBE_TTL_MS
        return sample.fingerprint === fingerprint && now - sample.at <= ttl
    } )

    const downloads = fresh.filter( sample => sample.source === `download` )
    if( downloads.length ) return { bps: conservative_speed( downloads ), source: `download` }

    const probes = fresh.filter( sample => sample.source === `probe` )
    if( probes.length ) return { bps: conservative_speed( probes ), source: `probe` }

    return null

}

/** Whether an active measurement should spend bandwidth. */
export const can_probe_network = ( navigator_like = globalThis.navigator ) =>
    navigator_like?.onLine !== false && navigator_like?.connection?.saveData !== true

const abort_error = () => {
    try {
        return new DOMException( `Network measurement aborted`, `AbortError` )
    } catch {
        return Object.assign( new Error( `Network measurement aborted` ), { name: `AbortError` } )
    }
}

/**
 * Stream a bounded byte range from the real GGUF host. The body is counted,
 * never buffered, and intentional cutoff still yields a valid partial sample.
 *
 * @param {string} url
 * @param {Object} [options]
 * @returns {Promise<{bps: number, bytes: number, ttfb_ms: number, elapsed_ms: number}>}
 */
export const probe_download_speed = async ( url, {
    signal,
    fetch_impl = fetch,
    now = () => performance.now(),
    max_bytes = 32 * MIB,
    sample_ms = 3_000,
    connect_timeout_ms = 8_000,
} = {} ) => {

    const controller = new AbortController()
    let externally_aborted = signal?.aborted || false
    let cutoff_fired = false
    let reader = null
    let sample_timer = null
    let connect_timer = null

    const external_abort = () => {
        externally_aborted = true
        controller.abort()
    }
    signal?.addEventListener( `abort`, external_abort, { once: true } )

    try {

        if( externally_aborted ) throw abort_error()

        const request_started = now()
        connect_timer = setTimeout( () => {
            cutoff_fired = true
            controller.abort()
        }, connect_timeout_ms )

        const response = await fetch_impl( url, {
            cache: `no-store`,
            headers: { Range: `bytes=0-${ max_bytes - 1 }` },
            redirect: `follow`,
            signal: controller.signal,
        } )

        clearTimeout( connect_timer )
        connect_timer = null

        if( !response.ok ) throw new Error( `Speed measurement failed: ${ response.status }` )
        if( !response.body?.getReader ) throw new Error( `Streaming response unavailable` )

        const headers_received = now()
        const ttfb_ms = headers_received - request_started
        reader = response.body.getReader()
        let bytes = 0
        let first_byte_at = null
        let last_byte_at = null

        sample_timer = setTimeout( () => {
            cutoff_fired = true
            controller.abort()
        }, sample_ms )

        try {
            while( bytes < max_bytes ) {
                const { done, value } = await reader.read()
                if( done ) break
                if( !value?.byteLength ) continue
                first_byte_at ??= now()
                bytes += Math.min( value.byteLength, max_bytes - bytes )
                last_byte_at = now()
                if( bytes >= max_bytes ) break
            }
        } catch ( error ) {
            if( externally_aborted ) throw abort_error()
            if( !cutoff_fired ) throw error
        }

        if( externally_aborted ) throw abort_error()

        const body_ms = first_byte_at === null ? 0 : Math.max( 1, last_byte_at - first_byte_at )
        const enough_data = bytes >= 256 * 1024 && ( bytes >= 8 * MIB || body_ms >= 1_000 )
        if( !enough_data ) throw new Error( `Network sample was too small to estimate reliably` )

        const elapsed_ms = Math.max( 1, ( last_byte_at || now() ) - request_started )
        return {
            bps: bytes / elapsed_ms * 1000,
            bytes,
            ttfb_ms,
            elapsed_ms,
        }

    } catch ( error ) {
        if( externally_aborted ) throw abort_error()
        if( cutoff_fired && !reader ) throw new Error( `Network measurement timed out` )
        throw error
    } finally {
        clearTimeout( sample_timer )
        clearTimeout( connect_timer )
        signal?.removeEventListener( `abort`, external_abort )
        try {
            await reader?.cancel()
        } catch {
            // Abort already closed the reader.
        }
        controller.abort()
    }

}

/**
 * Track conservative rolling throughput from an actual model download.
 *
 * @param {string} url
 * @param {Object} [options]
 */
export const create_download_speed_tracker = ( url, {
    now = Date.now,
    record = ( bps ) => record_speed_sample( url, bps, `download` ),
} = {} ) => {

    let samples = []
    let last_recorded_at = 0

    const update = ( { bytes_loaded } = {} ) => {

        if( !Number.isFinite( bytes_loaded ) || bytes_loaded <= 0 ) return

        const time = now()
        const previous = samples.at( -1 )
        if( previous && bytes_loaded < previous.bytes ) samples = []

        samples.push( { time, bytes: bytes_loaded } )
        samples = samples.filter( sample => time - sample.time <= 15_000 ).slice( -60 )

        const [ oldest ] = samples
        const elapsed_ms = time - oldest.time
        const transferred = bytes_loaded - oldest.bytes
        if( elapsed_ms < 2_000 || transferred < MIB || time - last_recorded_at < 2_000 ) return

        last_recorded_at = time
        record( transferred / elapsed_ms * 1000 )

    }

    return { update }

}

/**
 * Localized duration used by both model cards and active download ETA.
 *
 * @param {number} seconds
 * @param {Function} t
 * @returns {string}
 */
export const format_download_duration = ( seconds, t ) => {

    if( !Number.isFinite( seconds ) || seconds < 0 ) return ``

    if( seconds < 60 ) {
        const rounded_seconds = Math.max( 5, Math.ceil( seconds / 5 ) * 5 )
        return t( `common:duration_seconds`, { count: rounded_seconds } )
    }

    if( seconds < 600 ) {
        const rounded_seconds = Math.ceil( seconds / 15 ) * 15
        const minutes = Math.floor( rounded_seconds / 60 )
        const remaining_seconds = rounded_seconds % 60
        if( remaining_seconds === 0 ) return t( `common:duration_minutes`, { count: minutes } )
        return t( `common:duration_minutes_seconds`, { minutes, seconds: remaining_seconds } )
    }

    if( seconds < 3_600 ) {
        return t( `common:duration_minutes`, { count: Math.ceil( seconds / 60 ) } )
    }

    const total_minutes = Math.ceil( seconds / 300 ) * 5
    const hours = Math.floor( total_minutes / 60 )
    const minutes = total_minutes % 60
    if( minutes === 0 ) return t( `common:duration_hours`, { count: hours } )
    return t( `common:duration_hours_minutes`, { hours, minutes } )

}

/**
 * Format a full-file estimate, falling back to localized broad ranges.
 *
 * @param {number} file_size_bytes
 * @param {number|null} speed_bps
 * @param {Function} t
 * @returns {string}
 */
export const format_download_estimate = ( file_size_bytes, speed_bps, t ) => {

    if( speed_bps > 0 ) return format_download_duration( file_size_bytes / speed_bps, t )

    if( file_size_bytes < 500_000_000 ) return t( `models:download_range_under_minute` )
    if( file_size_bytes < 2_000_000_000 ) return t( `models:download_range_1_3_minutes` )
    if( file_size_bytes < 5_000_000_000 ) return t( `models:download_range_3_8_minutes` )
    if( file_size_bytes < 15_000_000_000 ) return t( `models:download_range_10_20_minutes` )
    if( file_size_bytes < 30_000_000_000 ) return t( `models:download_range_20_40_minutes` )
    return t( `models:download_range_40_plus_minutes` )

}
