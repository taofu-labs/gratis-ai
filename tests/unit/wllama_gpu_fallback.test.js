import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted( () => ( {
    instances: [],
    fail_gpu: false,
    fail_cpu: false,
    fail_gpu_inference: false,
    fail_benign_inference: false,
    probed: true,
    memory64: true,
    put: vi.fn(),
} ) )

vi.mock( `mentie`, () => ( {
    log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
} ) )

vi.mock( `wllama64`, () => {

    class WllamaError extends Error {
        constructor( message, type = `unknown_error` ) {
            super( message )
            this.type = type
        }
    }

    class WllamaRuntimeError extends Error {
        constructor( message ) {
            super( message )
            this.name = `WllamaRuntimeError`
        }
    }

    class Wllama {
        constructor() {
            this.loaded = false
            this.load_options = null
            mocks.instances.push( this )
        }
        setCompat() {}
        getWorkerResources() {
            return { compat: false }
        }
        async loadModel( _, options ) {
            this.load_options = options
            if( options.n_gpu_layers > 0 && mocks.fail_gpu ) throw new Error( `WebGPU backend failed` )
            if( options.n_gpu_layers === 0 && mocks.fail_cpu ) {
                throw new WllamaError( `Model failed`, `load_error` )
            }
            this.loaded = true
        }
        isModelLoaded() {
            return this.loaded
        }
        getChatTemplate() {
            return `{{ messages }}`
        }
        getModelMetadata() {
            return { meta: { 'general.name': `Test model`, 'general.architecture': `test` } }
        }
        async createChatCompletion() {
            if( this.load_options.n_gpu_layers > 0 && mocks.fail_benign_inference ) {
                throw new WllamaError( `KV cache full`, `kv_cache_full` )
            }
            if( this.load_options.n_gpu_layers > 0 && mocks.fail_gpu_inference ) {
                throw new Error( `GPU device lost` )
            }
            return {
                choices: [ { message: { content: `cpu answer` } } ],
                usage: { completion_tokens: 2 },
            }
        }
        async exit() {
            this.loaded = false
        }
    }

    return { Wllama, WllamaError, WllamaRuntimeError }

} )

vi.mock( `../../src/stores/db.js`, () => ( {
    get_db: async () => ( {
        get: async () => ( {
            blob: { size: 270_590_880 },
            file_size_bytes: 270_590_880,
        } ),
        put: mocks.put,
    } ),
} ) )

vi.mock( `../../src/utils/model_download.js`, () => ( {
    get_browser_cached_model: vi.fn(),
} ) )

vi.mock( `../../src/utils/device_detection.js`, () => ( {
    detect_capabilities: async () => ( {
        runtime: `browser`,
        wasm: { memory64: mocks.memory64 },
        memory: { device_memory: 8 },
        gpu: { webgpu: true },
    } ),
    estimate_max_model_bytes: () => 4_000_000_000,
    probe_capabilities_gpu_memory: async capabilities => ( {
        ...capabilities,
        gpu: mocks.probed
            ? { webgpu: true, memory_source: `measured`, allocatable_bytes: 2_000_000_000 }
            : { webgpu: true, memory_source: `reported`, allocatable_bytes: 8_000_000_000 },
    } ),
} ) )

const { default: WllamaProvider } = await import( `../../src/providers/wllama_provider.js` )

describe( `Wllama WebGPU fallback`, () => {

    beforeEach( () => {
        mocks.instances.length = 0
        mocks.fail_gpu = false
        mocks.fail_cpu = false
        mocks.fail_gpu_inference = false
        mocks.fail_benign_inference = false
        mocks.probed = true
        mocks.memory64 = true
        mocks.put.mockClear()
    } )

    test( `loads with a positive GPU target when the empirical probe permits it`, async () => {
        const provider = new WllamaProvider()
        await provider.load_model( `smollm2-360m-q4km` )

        expect( mocks.instances ).toHaveLength( 1 )
        expect( mocks.instances[ 0 ].load_options.n_gpu_layers ).toBeGreaterThan( 0 )
        expect( provider.is_ready() ).toBe( true )
    } )

    test( `recreates the runtime on CPU when WebGPU loading fails`, async () => {
        mocks.fail_gpu = true
        const provider = new WllamaProvider()

        await provider.load_model( `smollm2-360m-q4km` )

        expect( mocks.instances ).toHaveLength( 2 )
        expect( mocks.instances[ 0 ].load_options.n_gpu_layers ).toBeGreaterThan( 0 )
        expect( mocks.instances[ 1 ].load_options.n_gpu_layers ).toBe( 0 )
        expect( provider.is_ready() ).toBe( true )
    } )

    test( `never offloads from an unmeasured reported hint`, async () => {
        mocks.probed = false
        const provider = new WllamaProvider()

        await provider.load_model( `smollm2-360m-q4km` )

        expect( mocks.instances ).toHaveLength( 1 )
        expect( mocks.instances[ 0 ].load_options.n_gpu_layers ).toBe( 0 )
    } )

    test( `offloads through the package's wasm32 compatibility runtime`, async () => {
        mocks.memory64 = false
        const provider = new WllamaProvider()

        await provider.load_model( `smollm2-360m-q4km` )

        expect( mocks.instances ).toHaveLength( 1 )
        expect( mocks.instances[ 0 ].load_options.n_gpu_layers ).toBeGreaterThan( 0 )
    } )

    test( `surfaces the CPU failure after the internal GPU retry`, async () => {
        mocks.fail_gpu = true
        mocks.fail_cpu = true
        const provider = new WllamaProvider()

        await expect( provider.load_model( `smollm2-360m-q4km` ) )
            .rejects.toThrow( `could not be loaded by the browser runtime` )
        expect( mocks.instances ).toHaveLength( 2 )
    } )

    test( `reloads on CPU and retries an inference that loses WebGPU`, async () => {
        mocks.fail_gpu_inference = true
        const provider = new WllamaProvider()
        await provider.load_model( `smollm2-360m-q4km` )

        await expect( provider.chat( [ { role: `user`, content: `hello` } ] ) )
            .resolves.toBe( `cpu answer` )
        expect( mocks.instances ).toHaveLength( 2 )
        expect( mocks.instances[ 1 ].load_options.n_gpu_layers ).toBe( 0 )
    } )

    test( `does not demote WebGPU for a normal inference validation error`, async () => {
        mocks.fail_benign_inference = true
        const provider = new WllamaProvider()
        await provider.load_model( `smollm2-360m-q4km` )

        await expect( provider.chat( [ { role: `user`, content: `hello` } ] ) )
            .rejects.toMatchObject( { type: `kv_cache_full` } )
        expect( mocks.instances ).toHaveLength( 1 )
        expect( provider.is_ready() ).toBe( true )
    } )

    test( `clears provider readiness when the emergency CPU reload also fails`, async () => {
        mocks.fail_gpu_inference = true
        mocks.fail_cpu = true
        const provider = new WllamaProvider()
        await provider.load_model( `smollm2-360m-q4km` )

        await expect( provider.chat( [ { role: `user`, content: `hello` } ] ) )
            .rejects.toThrow( `could not be loaded by the browser runtime` )
        expect( provider.is_ready() ).toBe( false )
        expect( provider.get_loaded_model() ).toBeNull()
    } )

} )
