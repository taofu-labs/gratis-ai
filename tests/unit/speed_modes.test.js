import { afterEach, describe, expect, test, vi } from 'vitest'
import { build_device_profile, estimate_max_model_bytes } from '../../src/utils/device_detection'
import { MODEL_CATALOG, estimate_reply_speed, select_mode_models, select_for_preferences } from '../../src/utils/model_catalog'
import { FAST_TIP_SPEED, SLOW_TIP_SPEED, tip_direction } from '../../src/utils/speed_mode'

const WINDOWS_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36`

const laptop = () => {
    vi.stubGlobal( `navigator`, { userAgent: WINDOWS_UA, maxTouchPoints: 0 } )
    const capabilities = { runtime: `browser`, wasm: { memory64: true }, memory: { device_memory: 8 } }
    return build_device_profile( capabilities, estimate_max_model_bytes( capabilities ) )
}

afterEach( () => vi.unstubAllGlobals() )

describe( `speed modes`, () => {

    test( `modes run slow → fast, each a distinct model`, () => {
        const device = laptop()
        const modes = select_mode_models( MODEL_CATALOG, device )
        const speeds = modes.map( ( { model } ) => estimate_reply_speed( model, device ) )

        expect( modes.length ).toBeGreaterThanOrEqual( 2 )
        expect( new Set( modes.map( ( { model } ) => model.id ) ).size ).toBe( modes.length )
        expect( speeds ).toEqual( [ ...speeds ].sort( ( a, b ) => a - b ) )
    } )

    test( `balanced merges into an end of the scale when it lands on the same model`, () => {
        const device = laptop()
        const better = select_for_preferences( MODEL_CATALOG, device, { priority: `better` } ).pick
        const balanced = select_for_preferences( MODEL_CATALOG, device, { priority: `balanced` } ).pick
        const priorities = select_mode_models( MODEL_CATALOG, device ).map( ( { priority } ) => priority )

        // On this laptop Smarter and Balanced are both the 4B: one gauge, not two
        expect( balanced.id ).toBe( better.id )
        expect( priorities ).toEqual( [ `better`, `faster` ] )
    } )

    test( `a single possible model offers no modes to choose between`, () => {
        const only = MODEL_CATALOG.find( m => m.id === `minicpm5-1b-tpn-q4km` )
        expect( select_mode_models( [ only ], laptop() ) ).toHaveLength( 1 )
    } )

    test( `photo and uncensored choices carry into every mode`, () => {
        const modes = select_mode_models( MODEL_CATALOG, laptop(), { vision: true } )
        modes.forEach( ( { model } ) => expect( model.vision && model.mmproj ).toBeTruthy() )
    } )

    test( `tips point the right way and stay quiet in between`, () => {
        expect( tip_direction( SLOW_TIP_SPEED - 0.1 ) ).toBe( `faster` )
        expect( tip_direction( FAST_TIP_SPEED + 1 ) ).toBe( `better` )
        expect( tip_direction( 8 ) ).toBeNull()
        expect( tip_direction( 0 ) ).toBeNull()
    } )

} )
