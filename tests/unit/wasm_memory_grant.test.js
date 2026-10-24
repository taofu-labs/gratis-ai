import { afterEach, describe, expect, test, vi } from 'vitest'

describe( `WASM memory grant probe`, () => {

    afterEach( () => {
        vi.unstubAllGlobals()
        vi.resetModules()
    } )

    test( `grows a shared memory, which never copies (WebKit froze on non-shared grows)`, async () => {

        const descriptors = []
        class FakeMemory {
            constructor( descriptor ) {
                descriptors.push( descriptor )
                this.bytes = 65_536
            }
            grow( pages ) {
                const previous = BigInt( this.bytes / 65_536 )
                this.bytes += Number( pages ) * 65_536
                return previous
            }
            get buffer() {
                return { byteLength: this.bytes }
            }
        }

        vi.stubGlobal( `crossOriginIsolated`, true )
        vi.stubGlobal( `WebAssembly`, { ...WebAssembly, Memory: FakeMemory, Suspending: class {} } )

        const { probe_wasm_memory_grant, MEMORY64_MODEL_CEILING_BYTES } = await import( `../../src/utils/device_detection.js` )
        const granted = probe_wasm_memory_grant()

        expect( granted ).toBeGreaterThanOrEqual( MEMORY64_MODEL_CEILING_BYTES )
        expect( descriptors.every( descriptor => descriptor.shared === true ) ).toBe( true )

    } )

    test( `stops at its time budget when an engine grows slowly`, async () => {

        let now = 0
        vi.stubGlobal( `performance`, { now: () => now } )

        class SlowMemory {
            constructor() {
                this.bytes = 65_536
            }
            grow( pages ) {
                now += 300
                const previous = BigInt( this.bytes / 65_536 )
                this.bytes += Number( pages ) * 65_536
                return previous
            }
            get buffer() {
                return { byteLength: this.bytes }
            }
        }

        vi.stubGlobal( `crossOriginIsolated`, true )
        vi.stubGlobal( `WebAssembly`, { ...WebAssembly, Memory: SlowMemory, Suspending: class {} } )

        const { probe_wasm_memory_grant } = await import( `../../src/utils/device_detection.js` )

        // Two 300 ms steps pass the 500 ms budget: about 2 GB, not 15
        expect( probe_wasm_memory_grant() ).toBeLessThan( 3_000_000_000 )

    } )

} )
