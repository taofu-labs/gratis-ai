import { afterEach, describe, expect, test, vi } from 'vitest'
import { build_device_profile, estimate_max_model_bytes } from '../../src/utils/device_detection'
import {
    MODEL_CATALOG,
    NOTICEABLE_QUALITY_GAP,
    check_fit,
    estimate_reply_speed,
    has_image_input,
    implied_bandwidth_gbs,
    quality_score,
    runtime_memory,
    select_for_preferences,
    speed_band,
} from '../../src/utils/model_catalog'
import { record_bandwidth_sample } from '../../src/utils/speed_calibration'

const ANDROID_UA = `Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36`
const IPHONE_UA = `Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1`
const WINDOWS_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36`

// The four people this picker is for
const PERSONAS = {
    cheap_android: { ua: ANDROID_UA, capabilities: { runtime: `browser`, wasm: { memory64: true }, memory: { device_memory: 4 } } },
    iphone: { ua: IPHONE_UA, capabilities: { runtime: `browser`, wasm: { memory64: false }, memory: { device_memory: null } } },
    windows_laptop: { ua: WINDOWS_UA, capabilities: { runtime: `browser`, wasm: { memory64: true }, memory: { device_memory: 8 } } },
    macbook_desktop: {
        ua: ``,
        capabilities: {
            runtime: `electron`,
            platform: `darwin`,
            gpu: { metal: true, unified_memory: 34_359_738_368 },
            memory: { total_bytes: 34_359_738_368 },
        },
    },
}

const profile_for = name => {
    const { ua, capabilities } = PERSONAS[ name ]
    vi.stubGlobal( `navigator`, { userAgent: ua, maxTouchPoints: ua === IPHONE_UA || ua === ANDROID_UA ? 5 : 0 } )
    return build_device_profile( capabilities, estimate_max_model_bytes( capabilities ) )
}

// A synthetic build: one real model's shape, with the quality and speed under test
const variant = ( id, quality, browser_tps ) => {
    const base = MODEL_CATALOG.find( m => m.id === `qwen35-2b-tpn-q4km` )
    return { ...base, id, quality, browser_tps, tpn: undefined }
}

afterEach( () => vi.unstubAllGlobals() )

describe( `picker personas`, () => {

    test( `every persona gets a recommendation that fits comfortably`, () => {
        for( const name of Object.keys( PERSONAS ) ) {
            const device = profile_for( name )
            const { pick, fit, fallback } = select_for_preferences( MODEL_CATALOG, device )

            expect( pick, name ).not.toBeNull()
            expect( check_fit( pick, device ).comfortable, name ).toBe( true )
            expect( [ `roomy`, `fits` ] ).toContain( fit )
            expect( pick.hidden ).toBeFalsy()
            expect( pick.uncensored ).toBeFalsy()
            if( fallback ) expect( runtime_memory( fallback ) ).toBeLessThan( runtime_memory( pick ) )
        }
    } )

    test( `a Memory64 browser reporting 32 GB gets the full budget, capped by the measured grant`, () => {
        vi.stubGlobal( `navigator`, { userAgent: WINDOWS_UA, maxTouchPoints: 0 } )
        const profile = memory => {
            const capabilities = { runtime: `browser`, wasm: { memory64: true }, memory }
            return build_device_profile( capabilities, estimate_max_model_bytes( capabilities ) )
        }

        // Reported RAM above the clamp is real: comfortable and hard budget agree
        expect( profile( { device_memory: 32 } ) ).toMatchObject( { ram_gb: 32, budget_bytes: 15_000_000_000, automatic_bytes: 15_000_000_000 } )

        // Exactly 8 may be a clamp: stay conservative
        expect( profile( { device_memory: 8 } ) ).toMatchObject( { ram_gb: null, automatic_bytes: 5_600_000_000 } )

        // The runtime granted less than the RAM suggests: practice wins
        expect( profile( { device_memory: 32, wasm_grant_bytes: 9_000_000_000 } ) ).toMatchObject( { budget_bytes: 9_000_000_000, automatic_bytes: 9_000_000_000 } )
    } )

    test( `phones stay small and browsers stay under their runtime ceiling`, () => {
        const android = profile_for( `cheap_android` )
        const iphone = profile_for( `iphone` )

        expect( android ).toMatchObject( { kind: `phone`, mobile: true, ram_gb: 4, automatic_bytes: 2_000_000_000 } )
        expect( iphone ).toMatchObject( { kind: `iphone`, mobile: true, ram_gb: null, ceiling_bytes: 3_400_000_000 } )

        for( const device of [ android, iphone ] ) {
            const { pick } = select_for_preferences( MODEL_CATALOG, device )
            expect( runtime_memory( pick ) ).toBeLessThanOrEqual( device.automatic_bytes )
        }
    } )

    test( `the 32 GB MacBook desktop app gets a large model that a browser cannot run`, () => {
        const mac = profile_for( `macbook_desktop` )
        const laptop = profile_for( `windows_laptop` )
        const { pick } = select_for_preferences( MODEL_CATALOG, mac )

        expect( mac ).toMatchObject( { kind: `mac`, ram_gb: 32, ceiling_bytes: Infinity } )
        expect( runtime_memory( pick ) ).toBeGreaterThan( laptop.ceiling_bytes )
        expect( check_fit( pick, laptop ).fits ).toBe( false )
    } )

    test( `photo understanding requires a projector and changes the pick when needed`, () => {
        for( const name of Object.keys( PERSONAS ) ) {
            const device = profile_for( name )
            const { pick, relaxed } = select_for_preferences( MODEL_CATALOG, device, { vision: true } )
            if( pick ) expect( has_image_input( pick ), name ).toBe( true )
            else expect( relaxed.map( r => r.drop ) ).toEqual( [ `vision` ] )
        }
    } )

    test( `faster never picks a slower model than better answers`, () => {
        for( const name of Object.keys( PERSONAS ) ) {
            const device = profile_for( name )
            const faster = select_for_preferences( MODEL_CATALOG, device, { priority: `faster` } ).pick
            const better = select_for_preferences( MODEL_CATALOG, device, { priority: `better` } ).pick
            expect( estimate_reply_speed( faster, device ), name ).toBeGreaterThanOrEqual( estimate_reply_speed( better, device ) )
        }
    } )

    test( `fewer refusals only offers models with leaderboard evidence`, () => {
        for( const name of Object.keys( PERSONAS ) ) {
            const device = profile_for( name )
            const { pick, relaxed } = select_for_preferences( MODEL_CATALOG, device, { fewer_refusals: true } )

            // Nothing fits: say so and offer the standard model instead
            if( !pick ) expect( relaxed.map( r => r.drop ), name ).toEqual( [ `fewer_refusals` ] )
            else expect( pick.uncensored && pick.ugi.score > 0, name ).toBe( true )
        }

        // The tiny decensored build gives phones an answer too
        expect( select_for_preferences( MODEL_CATALOG, profile_for( `iphone` ), { fewer_refusals: true } ).pick?.id ).toBe( `qwen3-1.7b-decensored-tpn-q4km` )
    } )

    test( `an impossible combination is honest and offers the nearest alternatives`, () => {
        const device = { ...profile_for( `iphone` ), automatic_bytes: 1_400_000_000, budget_bytes: 1_400_000_000 }
        const { pick, relaxed } = select_for_preferences( MODEL_CATALOG, device, { vision: true, fewer_refusals: true } )

        expect( pick ).toBeNull()
        expect( relaxed.length ).toBeGreaterThan( 0 )
        relaxed.forEach( ( { model } ) => expect( check_fit( model, device ).fits ).toBe( true ) )
    } )

    test( `speed bands follow the bandwidth model`, () => {
        const laptop = profile_for( `windows_laptop` )
        const mac = profile_for( `macbook_desktop` )
        const tiny = MODEL_CATALOG.find( m => m.id === `qwen35-0.8b-q4km` )
        const scalar = MODEL_CATALOG.find( m => m.id === `qwen36-35b-a3b-iq3xxs` )

        expect( speed_band( estimate_reply_speed( tiny, laptop ) ) ).toBe( `quick` )
        expect( speed_band( estimate_reply_speed( scalar, laptop ) ) ).toBe( `slow` )

        // Scalar WASM kernels cost browsers dearly (on top of the 60 vs 5.8 GB/s gap); native builds are unaffected
        expect( estimate_reply_speed( scalar, mac ) / estimate_reply_speed( scalar, laptop ) ).toBeGreaterThan( 60 / 5.8 * 2.5 )
    } )

    test( `real replies calibrate the device's bandwidth, within reason`, () => {
        const store = {}
        vi.stubGlobal( `localStorage`, { getItem: key => store[ key ] ?? null, setItem: ( key, value ) => store[ key ] = value } )
        // A build without a reference speed: only those use the bandwidth model in browsers
        const tiny = MODEL_CATALOG.find( m => m.id === `qwen35-0.8b-q4km` )
        const before = profile_for( `windows_laptop` )

        // The inverse of the estimate: a reply at the estimated speed implies the guessed bandwidth
        expect( implied_bandwidth_gbs( tiny, `browser`, estimate_reply_speed( tiny, before ) ) ).toBeCloseTo( before.bandwidth_gbs )

        // Short replies teach nothing
        record_bandwidth_sample( `browser`, 2, 10 )
        expect( profile_for( `windows_laptop` ).bandwidth_gbs ).toBe( before.bandwidth_gbs )

        // A slower machine than guessed pulls the estimate down
        record_bandwidth_sample( `browser`, 2.9, 64 )
        expect( profile_for( `windows_laptop` ).bandwidth_gbs ).toBeCloseTo( 2.9 )

        // One wild sample can't swing it past 3× the guess
        for( let i = 0; i < 20; i++ ) record_bandwidth_sample( `browser`, 1_000, 64 )
        expect( profile_for( `windows_laptop` ).bandwidth_gbs ).toBeCloseTo( before.bandwidth_gbs * 3 )
    } )

    // The current catalog's answers, pinned so scoring changes are deliberate
    test( `recommends the expected starting models`, () => {
        const matrix = Object.fromEntries( Object.keys( PERSONAS ).map( name => {
            const device = profile_for( name )
            const pick_for = preferences => select_for_preferences( MODEL_CATALOG, device, preferences ).pick?.id
            return [ name, [ pick_for( { priority: `faster` } ), pick_for( {} ), pick_for( { priority: `better` } ), pick_for( { vision: true } ) ] ]
        } ) )

        expect( matrix ).toEqual( {
            cheap_android: [ `lfm25-1.2b-tpn-q4km`, `lfm25-1.2b-tpn-q4km`, `lfm25-1.2b-tpn-q6k`, `qwen35-0.8b-tpn-q5km` ],
            iphone: [ `lfm25-1.2b-tpn-q4km`, `lfm25-1.2b-tpn-q4km`, `lfm25-1.2b-tpn-q6k`, `qwen35-0.8b-tpn-q5km` ],
            windows_laptop: [ `lfm25-1.2b-tpn-q4km`, `lfm25-1.2b-tpn-q4km`, `gemma4-e2b-tpn-q4km`, `gemma4-e2b-tpn-q4km` ],
            macbook_desktop: [ `gemma4-26b-a4b-tpn-iq4xs`, `gemma4-26b-a4b-tpn-iq4xs`, `gemma4-26b-a4b-tpn-iq4xs`, `gemma4-26b-a4b-tpn-iq4xs` ],
        } )
    } )

    test( `balanced takes a smarter model over a faster one while replies stay usable`, () => {
        const models = [ variant( `quick`, 50, 8 ), variant( `smart`, 70, 2 ) ]
        const device = { ...profile_for( `windows_laptop` ), speed_ratio: 1 }
        const { pick } = select_for_preferences( models, device )
        const speed = estimate_reply_speed( pick, device )

        // Slower, but above the 1.5 tok/s floor
        expect( pick.id ).toBe( `smart` )
        expect( speed ).toBeGreaterThanOrEqual( 1.5 )
        expect( speed_band( speed ) ).toBe( `slow` )
    } )

    test( `a near-miss that outscores a qualifying step-up does not hide it`, () => {
        const models = [ variant( `pick`, 60, 8 ), variant( `near_miss`, 67, 2.4 ), variant( `smarter`, 68, 1 ) ]
        const device = { ...profile_for( `windows_laptop` ), speed_ratio: 1 }

        // Faster picks the quick one; near_miss (+7) would rank first but is under the gap
        expect( select_for_preferences( models, device, { priority: `faster` } ) ).toMatchObject( {
            pick: { id: `pick` },
            step_up: { id: `smarter` },
        } )
    } )

    test( `a slower device is offered a clearly smarter step-up it can still hold`, () => {
        const laptop = profile_for( `windows_laptop` )
        const slow_laptop = { ...laptop, bandwidth_gbs: laptop.bandwidth_gbs * 0.6 }

        for( const device of [ laptop, slow_laptop ] ) {
            const { pick, step_up } = select_for_preferences( MODEL_CATALOG, device )
            if( !step_up ) continue
            expect( quality_score( step_up ) - quality_score( pick ) ).toBeGreaterThanOrEqual( NOTICEABLE_QUALITY_GAP )
            expect( check_fit( step_up, device ).comfortable ).toBe( true )
            expect( estimate_reply_speed( step_up, device ) ).toBeGreaterThanOrEqual( 1 )
        }

        // Under the 1.5 tok/s floor but above 1: not the pick, offered as the step-up
        const models = [ variant( `pick`, 60, 8 ), variant( `smarter`, 70, 1.2 ) ]
        expect( select_for_preferences( models, { ...slow_laptop, speed_ratio: 1 } ) ).toMatchObject( {
            pick: { id: `pick` },
            step_up: { id: `smarter` },
        } )
    } )

} )
