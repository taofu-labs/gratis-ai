import { afterEach, describe, expect, test, vi } from 'vitest'
import { build_device_profile, estimate_max_model_bytes } from '../../src/utils/device_detection'
import {
    MODEL_CATALOG,
    check_fit,
    estimate_reply_speed,
    has_image_input,
    runtime_memory,
    select_for_preferences,
    speed_band,
} from '../../src/utils/model_catalog'

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

    // Re-enable when the TPN Gemma 4 26B build lands (TPN order g26): until then
    // the largest TPN build is the 9B, which a browser can also run
    test.skip( `the 32 GB MacBook desktop app gets a large model that a browser cannot run`, () => {
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

        // Scalar WASM kernels cost browsers dearly; native builds are unaffected
        expect( estimate_reply_speed( scalar, mac ) / estimate_reply_speed( scalar, laptop ) ).toBeCloseTo( 12 * 2.5 )
    } )

    // The current catalog's answers, pinned so scoring changes are deliberate
    test( `recommends the expected starting models`, () => {
        const matrix = Object.fromEntries( Object.keys( PERSONAS ).map( name => {
            const device = profile_for( name )
            const pick_for = preferences => select_for_preferences( MODEL_CATALOG, device, preferences ).pick?.id
            return [ name, [ pick_for( { priority: `faster` } ), pick_for( {} ), pick_for( { priority: `better` } ), pick_for( { vision: true } ) ] ]
        } ) )

        expect( matrix ).toEqual( {
            cheap_android: [ `qwen35-0.8b-tpn-q5km`, `minicpm5-1b-tpn-q4km`, `minicpm5-1b-tpn-q50t`, `qwen35-0.8b-tpn-q5km` ],
            iphone: [ `qwen35-0.8b-tpn-q5km`, `minicpm5-1b-tpn-q4km`, `minicpm5-1b-tpn-q50t`, `qwen35-0.8b-tpn-q5km` ],
            windows_laptop: [ `qwen35-0.8b-tpn-q5km`, `qwen35-2b-tpn-q4km`, `qwen35-2b-tpn-q4km`, `qwen35-2b-tpn-q4km` ],
            macbook_desktop: [ `qwen35-2b-tpn-q4km`, `qwen35-9b-tpn-iq4xs`, `qwen35-9b-tpn-iq4xs`, `qwen35-9b-tpn-iq4xs` ],
        } )
    } )

    test( `balanced prefers steady replies over a slow but smarter model`, () => {
        const laptop = profile_for( `windows_laptop` )
        const { pick } = select_for_preferences( MODEL_CATALOG, laptop )
        expect( speed_band( estimate_reply_speed( pick, laptop ) ) ).not.toBe( `slow` )
    } )

} )
