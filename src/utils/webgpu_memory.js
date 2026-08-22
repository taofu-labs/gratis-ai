const MIB = 1024 ** 2
const GIB = 1024 ** 3

export const WEBGPU_PROBE_CHUNKS = [ 256 * MIB, 64 * MIB, 16 * MIB ]
export const WEBGPU_PROBE_MAX_BYTES = 16 * GIB

let cached_probe = null
let probe_promise = null

const wait_with_timeout = ( promise, timeout_ms, label ) => new Promise( ( resolve, reject ) => {

    const timeout = setTimeout( () => reject( new Error( `${ label } timed out` ) ), timeout_ms )

    promise.then(
        value => {
            clearTimeout( timeout )
            resolve( value )
        },
        error => {
            clearTimeout( timeout )
            reject( error )
        },
    )

} )

/**
 * Convert the WebGPU per-buffer limit into the old immediate fallback hint.
 * This remains only a fallback while the allocation probe is pending/fails.
 *
 * @param {number} max_buffer_size
 * @returns {number}
 */
export const reported_webgpu_bytes = max_buffer_size => max_buffer_size > 0
    ? Math.min( WEBGPU_PROBE_MAX_BYTES, max_buffer_size * 2 )
    : 0

/**
 * Classify only adapters that positively identify as discrete. Masked and
 * ambiguous devices take the shared-memory safety path.
 *
 * @param {GPUAdapterInfo|Object} info
 * @returns {'discrete'|'shared_or_unknown'}
 */
export const classify_webgpu_adapter = ( info = {} ) => {

    const identity = [ info.vendor, info.architecture, info.device, info.description ]
        .filter( Boolean )
        .join( ` ` )
        .toLowerCase()

    if( identity.includes( `nvidia` ) || /geforce|quadro|tesla/.test( identity ) ) {
        return `discrete`
    }

    if( /radeon[-\s]?rx|firepro|intel[-\s]?arc[-\s]?a/.test( identity ) ) {
        return `discrete`
    }

    return `shared_or_unknown`

}

/**
 * Bound probing to memory that browser inference could use. Unknown/shared
 * adapters get an additional physical-memory guard because their buffers live
 * in the same pool as the full WASM model.
 *
 * @param {Object} options
 * @param {number} options.ram_budget_bytes
 * @param {number|null} options.device_memory_gb
 * @param {GPUAdapterInfo|Object} options.adapter_info
 * @returns {number}
 */
export const select_webgpu_probe_target = ( {
    ram_budget_bytes,
    device_memory_gb,
    adapter_info,
} ) => {

    // Offload is useful only when the full WASM model still has generous RAM
    // slack. Forty percent covers meaningful layer offload without probing for
    // memory that strict model selection can never use.
    const useful_target = Math.max( 0, Math.floor( ram_budget_bytes * 0.4 ) )
    if( classify_webgpu_adapter( adapter_info ) === `discrete` ) {
        return Math.min( WEBGPU_PROBE_MAX_BYTES, useful_target )
    }

    const reported_ram_guard = device_memory_gb
        ? Math.floor( device_memory_gb * GIB * 0.25 )
        : 1 * GIB

    return Math.min( WEBGPU_PROBE_MAX_BYTES, useful_target, reported_ram_guard )

}

const pop_scope_safely = async ( device, timeout_ms ) => {
    try {
        return await wait_with_timeout( device.popErrorScope(), timeout_ms, `WebGPU error scope` )
    } catch {
        return { message: `WebGPU device lost while reading its error scope` }
    }
}

/**
 * Retain and touch GPU buffers until allocation fails or the safety target is
 * reached. All allocations and the dedicated device are destroyed before the
 * promise resolves.
 *
 * @param {Object} options
 * @param {GPU} options.gpu
 * @param {number} options.max_bytes
 * @param {number} [options.timeout_ms]
 * @param {number} [options.operation_timeout_ms]
 * @param {number} [options.buffer_usage]
 * @param {() => number} [options.now]
 * @returns {Promise<Object>}
 */
export const measure_webgpu_allocatable_bytes = async ( {
    gpu,
    max_bytes,
    timeout_ms = 30_000,
    operation_timeout_ms = 4_000,
    buffer_usage = globalThis.GPUBufferUsage?.COPY_DST ?? 0x08,
    now = () => performance.now(),
} ) => {

    const started_at = now()
    const buffers = []
    let device = null
    let measured_bytes = 0
    let stop_reason = `limit`
    let capped = false

    try {

        if( !gpu || max_bytes < WEBGPU_PROBE_CHUNKS.at( -1 ) ) {
            return { measured_bytes: 0, status: `skipped`, reason: `no_useful_target`, capped: false }
        }

        const adapter = await wait_with_timeout(
            gpu.requestAdapter(),
            operation_timeout_ms,
            `WebGPU adapter request`,
        )

        if( !adapter ) return { measured_bytes: 0, status: `unavailable`, reason: `no_adapter`, capped: false }
        if( adapter.info?.isFallbackAdapter ) {
            return { measured_bytes: 0, status: `skipped`, reason: `fallback_adapter`, capped: false }
        }

        const max_buffer_size = adapter.limits?.maxBufferSize || WEBGPU_PROBE_CHUNKS[ 0 ]
        device = await wait_with_timeout( adapter.requestDevice( {
            requiredLimits: { maxBufferSize: max_buffer_size },
        } ), operation_timeout_ms, `WebGPU device request` )

        const lost = device.lost.then( info => ( { lost: true, info } ) )
        let baseline_submission_ms = null

        probe:
        for( const requested_chunk_size of WEBGPU_PROBE_CHUNKS ) {

            const chunk_size = Math.min( requested_chunk_size, max_buffer_size )
            if( chunk_size < WEBGPU_PROBE_CHUNKS.at( -1 ) ) continue

            while( measured_bytes + chunk_size <= max_bytes ) {

                if( now() - started_at >= timeout_ms ) {
                    stop_reason = `timeout`
                    capped = true
                    break probe
                }

                device.pushErrorScope( `out-of-memory` )
                device.pushErrorScope( `validation` )

                let buffer = null
                let operation_error = null
                const operation_started = now()

                try {
                    buffer = device.createBuffer( {
                        label: `gratisAI WebGPU memory probe`,
                        size: chunk_size,
                        usage: buffer_usage,
                    } )

                    const encoder = device.createCommandEncoder()
                    encoder.clearBuffer( buffer )
                    device.queue.submit( [ encoder.finish() ] )

                    const completed = await wait_with_timeout( Promise.race( [
                        device.queue.onSubmittedWorkDone().then( () => ( { lost: false } ) ),
                        lost,
                    ] ), operation_timeout_ms, `WebGPU allocation` )

                    if( completed?.lost ) operation_error = new Error( `WebGPU device lost` )
                } catch ( error ) {
                    operation_error = error
                }

                const validation_error = await pop_scope_safely( device, operation_timeout_ms )
                const memory_error = await pop_scope_safely( device, operation_timeout_ms )

                if( operation_error || validation_error || memory_error ) {
                    buffer?.destroy()
                    const failure_message = [ operation_error, validation_error, memory_error ]
                        .map( error => error?.message || `` )
                        .join( ` ` )

                    stop_reason = /device lost/i.test( failure_message )
                        ? `device_lost`
                        : /timed out/i.test( failure_message )
                            ? `timeout`
                            : `allocation_refused`
                    break
                }

                buffers.push( buffer )
                measured_bytes += chunk_size

                const submission_ms = now() - operation_started
                baseline_submission_ms ??= Math.max( 1, submission_ms )

                // Paging/thrashing can keep allocations succeeding long after
                // they stop representing usable inference memory.
                if( submission_ms > Math.max( 1_500, baseline_submission_ms * 6 ) ) {
                    stop_reason = `submission_slowdown`
                    capped = true
                    break probe
                }

            }

        }

        if( measured_bytes >= max_bytes - WEBGPU_PROBE_CHUNKS.at( -1 ) ) capped = true

        const unreliable = [ `device_lost`, `timeout` ].includes( stop_reason )

        return {
            measured_bytes,
            status: measured_bytes > 0 && !unreliable ? `measured` : `unavailable`,
            reason: stop_reason,
            capped: capped || unreliable,
            adapter_info: adapter.info || {},
        }

    } catch ( error ) {
        return {
            measured_bytes,
            status: measured_bytes > 0 ? `measured` : `unavailable`,
            reason: error?.message || `probe_failed`,
            capped: measured_bytes > 0,
        }
    } finally {
        for( const buffer of buffers ) buffer.destroy()
        device?.destroy?.()
    }

}

/**
 * Run at most one allocation probe per tab. Concurrent capability hooks and
 * model loads share the same promise so probing never competes with itself.
 *
 * @param {Object} options - measure_webgpu_allocatable_bytes options
 * @returns {Promise<Object>}
 */
export const get_webgpu_memory_probe = async options => {
    if( cached_probe ) return cached_probe
    if( !probe_promise ) {
        probe_promise = measure_webgpu_allocatable_bytes( options )
            .then( result => {
                cached_probe = result
                return result
            } )
            .finally( () => {
                probe_promise = null
            } )
    }
    return probe_promise
}

/** Return a finished tab-local probe without starting an allocation. */
export const get_cached_webgpu_memory_probe = () => cached_probe

/** Reset module state for isolated unit tests. */
export const reset_webgpu_memory_probe = () => {
    cached_probe = null
    probe_promise = null
}
