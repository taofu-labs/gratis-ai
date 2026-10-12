import { afterEach, describe, expect, test, vi } from 'vitest'
import { EVENTS, storage_key } from '../../src/utils/branding'
import {
    BROWSER_AUTOMATIC_MODEL_CEILING_BYTES,
    BROWSER_RAM_OVERRIDE_KEY,
    MEMORY64_MODEL_CEILING_BYTES,
    estimate_max_model_bytes,
    read_browser_ram_override,
    set_browser_ram_override,
} from '../../src/utils/device_detection'

const store = new Map()
const memory_storage = {
    getItem: key => store.has( key ) ? store.get( key ) : null,
    setItem: ( key, value ) => store.set( key, String( value ) ),
    removeItem: key => store.delete( key ),
}
vi.stubGlobal( `localStorage`, memory_storage )
vi.stubGlobal( `window`, new EventTarget() )

const browser = ( memory64, device_memory = 8 ) => ( {
    runtime: `browser`,
    wasm: { memory64 },
    memory: { device_memory, js_heap_limit: 4_294_705_152 },
} )

afterEach( () => store.clear() )

describe( `browser RAM override`, () => {

    test( `uses the automatic ceiling without an override`, () => {
        expect( estimate_max_model_bytes( browser( true ) ) ).toBe( BROWSER_AUTOMATIC_MODEL_CEILING_BYTES )
    } )

    test( `uses 60 percent of declared RAM`, () => {
        set_browser_ram_override( 16 )
        expect( read_browser_ram_override() ).toBe( 16 )
        expect( estimate_max_model_bytes( browser( true ) ) ).toBe( 9_600_000_000 )

        set_browser_ram_override( 24 )
        expect( estimate_max_model_bytes( browser( true ) ) ).toBe( 14_400_000_000 )
    } )

    test( `never exceeds the Memory64 ceiling`, () => {
        set_browser_ram_override( 64 )
        expect( estimate_max_model_bytes( browser( true ) ) ).toBe( MEMORY64_MODEL_CEILING_BYTES )
    } )

    test( `ignores the override on wasm32 and Electron`, () => {
        const wasm32 = browser( false, null )
        const electron = { runtime: `electron`, gpu: {}, memory: { total_bytes: 16_000_000_000 } }
        const wasm32_baseline = estimate_max_model_bytes( wasm32 )
        const electron_baseline = estimate_max_model_bytes( electron )

        set_browser_ram_override( 32 )
        expect( estimate_max_model_bytes( wasm32 ) ).toBe( wasm32_baseline )
        expect( estimate_max_model_bytes( electron ) ).toBe( electron_baseline )
    } )

    test( `notifies same-tab listeners and can be reset`, () => {
        const listener = vi.fn()
        window.addEventListener( EVENTS.settings_changed, listener )
        set_browser_ram_override( 24 )
        set_browser_ram_override( null )
        window.removeEventListener( EVENTS.settings_changed, listener )

        expect( read_browser_ram_override() ).toBeNull()
        expect( listener.mock.calls.map( ( [ event ] ) => event.detail ) ).toEqual( [
            { key: BROWSER_RAM_OVERRIDE_KEY, value: 24 },
            { key: BROWSER_RAM_OVERRIDE_KEY, value: null },
        ] )
    } )

    test( `blocked storage falls back without throwing`, () => {
        Object.defineProperty( globalThis, `localStorage`, {
            configurable: true,
            get: () => {
                throw new DOMException( `The operation is insecure.`, `SecurityError` )
            },
        } )

        try {
            expect( set_browser_ram_override( 32 ) ).toBe( false )
            expect( read_browser_ram_override() ).toBeNull()
            expect( estimate_max_model_bytes( browser( true ) ) ).toBe( BROWSER_AUTOMATIC_MODEL_CEILING_BYTES )
        } finally {
            vi.stubGlobal( `localStorage`, memory_storage )
        }
    } )

    test( `ignores invalid or non-raising stored values`, () => {
        for( const value of [ `abc`, `8`, `-16`, `` ] ) {
            store.set( storage_key( BROWSER_RAM_OVERRIDE_KEY ), value )
            expect( read_browser_ram_override() ).toBeNull()
        }
    } )

} )
