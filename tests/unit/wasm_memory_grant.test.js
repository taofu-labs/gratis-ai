import { afterEach, describe, expect, test, vi } from 'vitest'

// A worker that answers with `reply`, or never answers when it is undefined
const fake_worker = reply => {
    const workers = []
    class FakeWorker {
        constructor() {
            workers.push( this )
            this.terminated = false
            if( reply !== undefined ) queueMicrotask( () => this.onmessage?.( { data: reply } ) )
        }
        terminate() {
            this.terminated = true
        }
    }
    return { FakeWorker, workers }
}

const stub_memory64 = () => {
    vi.stubGlobal( `crossOriginIsolated`, true )
    vi.stubGlobal( `WebAssembly`, { ...WebAssembly, Memory: class { grow() { return 1n } }, Suspending: class {} } )
}

describe( `WASM memory grant probe`, () => {

    afterEach( () => {
        vi.useRealTimers()
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

        vi.stubGlobal( `WebAssembly`, { ...WebAssembly, Memory: FakeMemory } )

        const { grow_wasm_memory, MEMORY64_MODEL_CEILING_BYTES } = await import( `../../src/utils/device_detection.js` )

        expect( grow_wasm_memory( MEMORY64_MODEL_CEILING_BYTES ) ).toBeGreaterThanOrEqual( MEMORY64_MODEL_CEILING_BYTES )
        expect( descriptors.every( descriptor => descriptor.shared === true ) ).toBe( true )

    } )

    test( `a refused grow is the practical limit`, async () => {

        class TightMemory {
            constructor() {
                this.bytes = 65_536
            }
            grow( pages ) {
                if( this.bytes > 3_000_000_000 ) throw new RangeError( `Unable to grow instance memory` )
                this.bytes += Number( pages ) * 65_536
            }
            get buffer() {
                return { byteLength: this.bytes }
            }
        }

        vi.stubGlobal( `WebAssembly`, { ...WebAssembly, Memory: TightMemory } )

        const { grow_wasm_memory } = await import( `../../src/utils/device_detection.js` )

        expect( grow_wasm_memory( 15_000_000_000 ) ).toBeLessThan( 4_100_000_000 )

    } )

    test( `measures in a worker, then frees it and shares the result`, async () => {

        stub_memory64()
        const { FakeWorker, workers } = fake_worker( 9_000_000_000 )
        vi.stubGlobal( `Worker`, FakeWorker )

        const { measure_wasm_memory_grant, probe_wasm_memory_grant, with_latest_grant } = await import( `../../src/utils/device_detection.js` )

        expect( await measure_wasm_memory_grant() ).toBe( 9_000_000_000 )
        expect( workers.every( worker => worker.terminated ) ).toBe( true )
        expect( probe_wasm_memory_grant() ).toBe( 9_000_000_000 )
        expect( with_latest_grant( { runtime: `browser`, memory: { device_memory: 16 } } ).memory ).toEqual( { device_memory: 16, wasm_grant_bytes: 9_000_000_000 } )

    } )

    test( `a check that runs out of time reads as unmeasured, not as a small grant`, async () => {

        vi.useFakeTimers()
        stub_memory64()
        const { FakeWorker, workers } = fake_worker( undefined )
        vi.stubGlobal( `Worker`, FakeWorker )

        const { measure_wasm_memory_grant, WASM_GRANT_TIMEOUT_MS } = await import( `../../src/utils/device_detection.js` )

        const measured = measure_wasm_memory_grant()
        await vi.advanceTimersByTimeAsync( WASM_GRANT_TIMEOUT_MS )

        expect( await measured ).toBeNull()
        expect( workers[ 0 ].terminated ).toBe( true )

    } )

} )
