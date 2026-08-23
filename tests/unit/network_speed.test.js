import { describe, expect, test, vi } from 'vitest'
import {
    can_probe_network,
    connection_fingerprint,
    create_download_speed_tracker,
    format_download_duration,
    get_speed_estimate,
    probe_download_speed,
    record_speed_sample,
} from '../../src/utils/network_speed'

class MemoryStorage {
    constructor() {
        this.values = new Map()
    }
    getItem( key ) {
        return this.values.get( key ) ?? null
    }
    setItem( key, value ) {
        this.values.set( key, value )
    }
}

const stream_response = chunks => new Response( new ReadableStream( {
    start( controller ) {
        for( const chunk of chunks ) controller.enqueue( new Uint8Array( chunk ) )
        controller.close()
    },
} ), { status: 206 } )

describe( `network speed evidence`, () => {

    test( `streams a single range and counts body bytes`, async () => {
        const fetch_impl = vi.fn( async () => stream_response( [ 256 * 1024, 256 * 1024 ] ) )
        const times = [ 0, 100, 200, 300, 1_400 ]

        const sample = await probe_download_speed( `https://huggingface.co/org/model.gguf`, {
            fetch_impl,
            max_bytes: 512 * 1024,
            now: () => times.shift() ?? 1_400,
        } )

        expect( fetch_impl ).toHaveBeenCalledWith(
            `https://huggingface.co/org/model.gguf`,
            expect.objectContaining( {
                headers: { Range: `bytes=0-524287` },
                cache: `no-store`,
            } ),
        )
        expect( sample.bytes ).toBe( 512 * 1024 )
        expect( sample.ttfb_ms ).toBe( 100 )
        expect( sample.bps ).toBeCloseTo( 512 * 1024 / 1.4, 0 )
    } )

    test( `prefers conservative real-download history over a probe`, () => {
        const storage = new MemoryStorage()
        const url = `https://cdn.example/model.gguf`
        const options = { storage, now: 10_000, fingerprint: `wifi:4g:normal-data` }

        record_speed_sample( url, 20_000_000, `probe`, options )
        record_speed_sample( url, 5_000_000, `download`, options )
        record_speed_sample( url, 8_000_000, `download`, { ...options, now: 11_000 } )

        expect( get_speed_estimate( url, { ...options, now: 12_000 } ) ).toEqual( {
            bps: 4_500_000,
            source: `download`,
        } )
    } )

    test( `distinguishes a connection timeout from caller cancellation`, async () => {
        const fetch_impl = vi.fn( ( _, { signal } ) => new Promise( ( _, reject ) => {
            signal.addEventListener( `abort`, () => reject( new DOMException( `Aborted`, `AbortError` ) ) )
        } ) )

        await expect( probe_download_speed( `https://cdn.example/model.gguf`, {
            fetch_impl,
            connect_timeout_ms: 1,
        } ) ).rejects.toThrow( `Network measurement timed out` )
    } )

    test( `invalidates stale evidence when the connection class changes`, () => {
        const storage = new MemoryStorage()
        const url = `https://cdn.example/model.gguf`
        record_speed_sample( url, 5_000_000, `download`, {
            storage,
            now: 1_000,
            fingerprint: `wifi:4g:normal-data`,
        } )

        expect( get_speed_estimate( url, {
            storage,
            now: 2_000,
            fingerprint: `cellular:3g:normal-data`,
        } ) ).toBeNull()
    } )

    test( `records actual rolling downloads only after useful evidence`, () => {
        const record = vi.fn()
        const times = [ 0, 1_000, 2_500 ]
        const tracker = create_download_speed_tracker( `https://cdn.example/model.gguf`, {
            now: () => times.shift(),
            record,
        } )

        tracker.update( { bytes_loaded: 1 } )
        tracker.update( { bytes_loaded: 500_000 } )
        tracker.update( { bytes_loaded: 2_500_001 } )

        expect( record ).toHaveBeenCalledOnce()
        expect( record ).toHaveBeenCalledWith( 1_000_000 )
    } )

    test( `respects offline and Save-Data signals`, () => {
        expect( can_probe_network( { onLine: false } ) ).toBe( false )
        expect( can_probe_network( { onLine: true, connection: { saveData: true } } ) ).toBe( false )
        expect( can_probe_network( { onLine: true, connection: { saveData: false } } ) ).toBe( true )
        expect( connection_fingerprint( { type: `wifi`, effectiveType: `4g`, saveData: false } ) )
            .toBe( `wifi:4g:normal-data` )
    } )

    test( `formats distinct granular durations`, () => {
        const t = ( key, values ) => `${ key } ${ JSON.stringify( values ) }`

        expect( format_download_duration( 44, t ) ).toContain( `duration_seconds` )
        expect( format_download_duration( 95, t ) ).toContain( `"minutes":1,"seconds":45` )
        expect( format_download_duration( 601, t ) ).toContain( `duration_minutes` )
        expect( format_download_duration( 3_700, t ) ).toContain( `duration_hours_minutes` )
    } )

} )
