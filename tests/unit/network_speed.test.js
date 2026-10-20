import { describe, expect, test, vi } from 'vitest'
import {
    can_probe_network,
    connection_fingerprint,
    create_download_eta_estimator,
    create_download_speed_tracker,
    format_download_duration,
    get_speed_estimate,
    probe_download_speed,
    record_speed_sample,
} from '../../src/utils/network_speed'
import xet_trace from '../fixtures/xet_download_trace.json'

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

    test( `passes auth headers to the range probe`, async () => {
        const fetch_impl = vi.fn( async () => stream_response( [ 256 * 1024, 256 * 1024 ] ) )
        const times = [ 0, 100, 200, 300, 1_400 ]

        await probe_download_speed( `https://huggingface.co/org/model.gguf`, {
            fetch_impl,
            headers: { Authorization: `Bearer hf_test` },
            max_bytes: 512 * 1024,
            now: () => times.shift() ?? 1_400,
        } )

        expect( fetch_impl ).toHaveBeenCalledWith(
            `https://huggingface.co/org/model.gguf`,
            expect.objectContaining( {
                headers: {
                    Authorization: `Bearer hf_test`,
                    Range: `bytes=0-524287`,
                },
            } ),
        )
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

describe( `download ETA estimator`, () => {

    const MIB = 1024 ** 2

    // Feed (ms, bytes) pairs through a controllable clock
    const drive = ( estimator, clock, samples, total ) => samples.reduce( ( _, [ time, bytes ] ) => {
        clock.time = time
        return estimator.update( { bytes_loaded: bytes, bytes_total: total } )
    }, null )

    test( `stays quiet until evidence exists and ignores setup latency`, () => {
        const clock = { time: 0 }
        const estimator = create_download_eta_estimator( { now: () => clock.time } )

        // 2 s of connection setup, then 10 MiB/s from the first chunk on
        const early = drive( estimator, clock, [ [ 0, 0 ], [ 2_000, MIB ], [ 4_000, 21 * MIB ], [ 6_000, 41 * MIB ] ], 400 * MIB )
        expect( early.is_ready ).toBe( false )
        expect( early.eta_seconds ).toBeNull()

        const ready = drive( estimator, clock, [ [ 7_000, 51 * MIB ] ], 400 * MIB )
        expect( ready.is_ready ).toBe( true )
        expect( ready.bps / MIB ).toBeCloseTo( 10, 1 )
        expect( ready.eta_seconds ).toBeCloseTo( 34.9, 0 )
    } )

    test( `replays a real Hugging Face Xet download within 2x of the truth`, () => {
        const clock = { time: 0 }
        const estimator = create_download_eta_estimator( { now: () => clock.time } )
        const { total, samples } = xet_trace
        const finish = samples.at( -1 )[ 0 ]

        const ratios = samples.flatMap( ( [ time, bytes ] ) => {
            clock.time = time
            const { eta_seconds } = estimator.update( { bytes_loaded: bytes, bytes_total: total } )
            const truth = ( finish - time ) / 1000
            return eta_seconds && truth > 3 ? [ eta_seconds / truth ] : []
        } )

        // Xet ramps up for ~10 s; the old estimator showed hours there
        expect( ratios.length ).toBeGreaterThan( 200 )
        expect( Math.max( ...ratios.map( ratio => Math.max( ratio, 1 / ratio ) ) ) ).toBeLessThan( 2.2 )
    } )

    test( `matches real duration for a steady download instead of overshooting`, () => {
        const clock = { time: 0 }
        const estimator = create_download_eta_estimator( { now: () => clock.time } )
        const total = 390 * MIB
        const rate = 10 * MIB

        // A slow start (connection setup) followed by steady throughput
        const samples = [ [ 0, 0 ], [ 500, 64 * 1024 ] ]
        for( let time = 1_000; time <= 15_000; time += 250 ) samples.push( [ time, ( time - 1_000 ) / 1000 * rate + 64 * 1024 ] )

        const { eta_seconds } = drive( estimator, clock, samples, total )
        const true_remaining = ( total - samples.at( -1 )[ 1 ] ) / rate
        expect( Math.abs( eta_seconds - true_remaining ) / true_remaining ).toBeLessThan( 0.1 )
    } )

    test( `absorbs bursty progress without wild swings`, () => {
        const clock = { time: 0 }
        const estimator = create_download_eta_estimator( { now: () => clock.time } )
        const total = 400 * MIB
        const etas = []

        // 4 MiB lands in one burst every 400 ms, nothing in between (~10 MiB/s)
        let bytes = 0
        for( let time = 0; time <= 20_000; time += 100 ) {
            if( time % 400 === 0 ) bytes += 4 * MIB
            clock.time = time
            const { eta_seconds } = estimator.update( { bytes_loaded: bytes, bytes_total: total } )
            if( time > 5_000 && eta_seconds ) etas.push( eta_seconds + time / 1000 )
        }

        // Predicted finish time should be stable within a few seconds
        expect( Math.max( ...etas ) - Math.min( ...etas ) ).toBeLessThan( 5 )
    } )

    test( `resets when bytes go backwards and reports done at 100%`, () => {
        const clock = { time: 0 }
        const estimator = create_download_eta_estimator( { now: () => clock.time } )

        drive( estimator, clock, [ [ 0, 0 ], [ 4_000, 40 * MIB ] ], 100 * MIB )
        const restarted = drive( estimator, clock, [ [ 4_500, MIB ] ], 100 * MIB )
        expect( restarted.is_ready ).toBe( false )

        const done = drive( estimator, clock, [ [ 9_000, 100 * MIB ] ], 100 * MIB )
        expect( done.eta_seconds ).toBe( 0 )
        expect( done.is_slowed ).toBe( false )
    } )

    test( `flags a sustained slowdown against the long-run rate`, () => {
        const clock = { time: 0 }
        const estimator = create_download_eta_estimator( { now: () => clock.time } )
        const samples = []
        let bytes = 0
        for( let time = 0; time <= 30_000; time += 500 ) {
            bytes += time < 22_000 ? 5 * MIB : 0.25 * MIB
            samples.push( [ time, bytes ] )
        }

        expect( drive( estimator, clock, samples, 2_000 * MIB ).is_slowed ).toBe( true )
    } )

} )
