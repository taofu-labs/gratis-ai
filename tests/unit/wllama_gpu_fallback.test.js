import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted( () => ( {
    instances: [],
    fail_gpu: false,
    fail_cpu: false,
    fail_gpu_inference: false,
    fail_benign_inference: false,
    probed: true,
    memory64: true,
    compat: false,
    memory_budget: 4_000_000_000,
    put: vi.fn(),
    cached_model: null,
    projector: null,
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
            this.source = null
            this.load_options = null
            mocks.instances.push( this )
        }
        setCompat() {}
        getWorkerResources() {
            return { compat: mocks.compat }
        }
        async loadModel( source, options ) {
            this.source = source
            this.load_options = options
            if( mocks.load_delay_ms ) await new Promise( resolve => setTimeout( resolve, mocks.load_delay_ms ) )
            if( mocks.load_hangs ) await new Promise( () => {} )
            if( options.n_gpu_layers > 0 && mocks.fail_gpu ) throw new Error( `WebGPU backend failed` )
            if( options.n_gpu_layers === 0 && mocks.fail_cpu ) {
                throw new WllamaError( `Model failed`, `load_error` )
            }
            if( options.cache_type_k === `q8_0` && mocks.fail_quantized_kv ) {
                throw new WllamaError( `Model failed`, `load_error` )
            }
            this.loaded = true
        }
        isModelLoaded() {
            return this.loaded
        }
        supportInputModality( modality ) {
            return modality === `image` && !!this.source?.some?.( blob => blob?.is_projector )
        }
        getChatTemplate() {
            return `{{ messages }}`
        }
        getModelMetadata() {
            return { meta: { 'general.name': `Test model`, 'general.architecture': `test` } }
        }
        async createChatCompletion( { messages } ) {
            mocks.last_messages = messages
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
        get: async () => mocks.cached_model || ( {
            blob: { size: 270_590_880 },
            file_size_bytes: 270_590_880,
        } ),
        put: mocks.put,
    } ),
} ) )

vi.mock( `../../src/utils/model_download.js`, () => ( {
    get_browser_cached_model: vi.fn(),
    projector_source: model => model?.mmproj ? { ...model.mmproj, url: `https://hf.test/${ model.mmproj.file_name }` } : null,
    get_browser_cached_projector: vi.fn( async () => mocks.projector ),
    verify_installed_model: vi.fn( async () => {} ),
} ) )

vi.mock( `../../src/utils/device_detection.js`, () => ( {
    detect_capabilities: async () => ( {
        runtime: `browser`,
        wasm: { memory64: mocks.memory64 },
        memory: { device_memory: 8 },
        gpu: { webgpu: true, adapter_info: mocks.adapter_info || {} },
    } ),
    estimate_max_model_bytes: () => mocks.memory_budget,
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
        mocks.fail_quantized_kv = false
        mocks.load_delay_ms = 0
        mocks.load_hangs = false
        mocks.fail_gpu_inference = false
        mocks.fail_benign_inference = false
        mocks.probed = true
        mocks.memory64 = true
        mocks.compat = false
        mocks.memory_budget = 4_000_000_000
        mocks.cached_model = null
        mocks.projector = null
        mocks.adapter_info = null
        mocks.put.mockClear()
        vi.unstubAllGlobals()
    } )

    test( `loads with a positive GPU target when the empirical probe permits it`, async () => {
        const provider = new WllamaProvider()
        await provider.load_model( `smollm2-360m-q4km` )

        expect( mocks.instances ).toHaveLength( 1 )
        expect( mocks.instances[ 0 ].load_options.n_gpu_layers ).toBeGreaterThan( 0 )
        expect( provider.is_ready() ).toBe( true )
    } )

    test( `prefills with twice the decode threads, never more than the cores`, async () => {
        vi.stubGlobal( `navigator`, { ...navigator, hardwareConcurrency: 8 } )
        const provider = new WllamaProvider()
        await provider.load_model( `smollm2-360m-q4km` )

        const { n_threads, n_threads_batch } = mocks.instances[ 0 ].load_options
        expect( [ n_threads, n_threads_batch ] ).toEqual( [ 4, 8 ] )
    } )

    test( `keeps one thread pool on phones and in the compat runtime`, async () => {
        vi.stubGlobal( `navigator`, { ...navigator, hardwareConcurrency: 8, userAgent: `Mozilla/5.0 (Linux; Android 15) Mobile` } )
        await new WllamaProvider().load_model( `smollm2-360m-q4km` )

        vi.stubGlobal( `navigator`, { ...navigator, hardwareConcurrency: 8, userAgent: `Mozilla/5.0 (X11; Linux x86_64)` } )
        mocks.compat = true
        await new WllamaProvider().load_model( `smollm2-360m-q4km` )

        for( const { load_options } of mocks.instances ) expect( load_options.n_threads_batch ).toBe( load_options.n_threads )
    } )

    test( `loads on CPU on mobile GPUs whose WebGPU kernels produce garbage`, async () => {
        mocks.adapter_info = { vendor: `qualcomm`, architecture: `adreno-8xx` }

        const provider = new WllamaProvider()
        await provider.load_model( `smollm2-360m-q4km` )

        expect( mocks.instances ).toHaveLength( 1 )
        expect( mocks.instances[ 0 ].load_options.n_gpu_layers ).toBe( 0 )
    } )

    test( `loads a browser model from a saved file handle`, async () => {
        const file = { size: 270_590_880 }
        mocks.cached_model = {
            file_handle: {
                queryPermission: vi.fn( async () => `granted` ),
                getFile: vi.fn( async () => file ),
            },
            file_size_bytes: 270_590_880,
        }

        const provider = new WllamaProvider()
        await provider.load_model( `smollm2-360m-q4km` )

        expect( mocks.instances ).toHaveLength( 1 )
        expect( mocks.instances[ 0 ].source ).toEqual( [ file ] )
        expect( provider.is_ready() ).toBe( true )
    } )

    test( `uses cached architecture metadata for custom browser models`, async () => {
        mocks.memory_budget = 5_600_000_000
        const file = { size: 4_859_552_672 }
        mocks.cached_model = {
            id: `custom-tpn002-entry-a`,
            file_handle: {
                queryPermission: vi.fn( async () => `granted` ),
                getFile: vi.fn( async () => file ),
            },
            file_size_bytes: 4_859_552_672,
            family: `qwen35`,
            parameters: 8_953_803_264,
            parameters_label: `9B`,
            context_length: 262_144,
            layers: 8,
            block_count: 32,
            kv_heads: 4,
            head_dim: 256,
            reasoning: true,
            reasoning_enabled: false,
        }

        const provider = new WllamaProvider()
        await provider.load_model( `custom-tpn002-entry-a` )

        expect( mocks.instances ).toHaveLength( 1 )
        expect( mocks.instances[ 0 ].source ).toEqual( [ file ] )
        expect( mocks.instances[ 0 ].load_options.n_ctx ).toBeGreaterThan( 2048 )
        expect( mocks.instances[ 0 ].load_options.default_template_kwargs ).toEqual( {
            enable_thinking: false,
        } )
        expect( provider.is_ready() ).toBe( true )
    } )

    test( `backfills stale custom cache metadata before loading`, async () => {
        mocks.memory_budget = 5_600_000_000
        const file = { size: 4_859_552_672 }
        mocks.cached_model = {
            id: `custom-tpn002-entry-a`,
            file_handle: {
                queryPermission: vi.fn( async () => `granted` ),
                getFile: vi.fn( async () => file ),
            },
            download_url: `https://huggingface.co/tatjr13/tpn002-entry-a/resolve/main/model.gguf`,
            hugging_face_repo: `tatjr13/tpn002-entry-a`,
            file_name: `model.gguf`,
            file_size_bytes: 4_859_552_672,
            context_length: 4096,
            quantization: `GGUF`,
        }
        vi.stubGlobal( `fetch`, vi.fn( async url => {
            if( !String( url ).includes( `/api/models/tatjr13/tpn002-entry-a?blobs=true` ) ) {
                return { ok: false, status: 404 }
            }
            return {
                ok: true,
                json: async () => ( {
                    gguf: {
                        total: 8_953_803_264,
                        architecture: `qwen35`,
                        context_length: 262_144,
                        totalFileSize: 4_859_552_672,
                    },
                    siblings: [
                        {
                            rfilename: `model.gguf`,
                            size: 4_859_552_672,
                            lfs: { size: 4_859_552_672 },
                        },
                    ],
                } ),
            }
        } ) )

        const provider = new WllamaProvider()
        await provider.load_model( `custom-tpn002-entry-a` )

        expect( mocks.instances ).toHaveLength( 1 )
        expect( mocks.instances[ 0 ].source ).toEqual( [ file ] )
        expect( mocks.instances[ 0 ].load_options.n_ctx ).toBeGreaterThan( 2048 )
        expect( mocks.put ).toHaveBeenCalledWith( `models`, expect.objectContaining( {
            id: `custom-tpn002-entry-a`,
            layers: 8,
            kv_heads: 4,
            head_dim: 256,
            file_handle: mocks.cached_model.file_handle,
        } ) )
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

    test( `uses the fast CPU KV path only for CPU loads`, async () => {
        mocks.fail_gpu = true
        const provider = new WllamaProvider()

        await provider.load_model( `smollm2-360m-q4km` )

        const [ gpu, cpu ] = mocks.instances.map( ( { load_options } ) => load_options )
        expect( gpu ).toMatchObject( { cache_type_k: `f16`, cache_type_v: `f16` } )
        expect( gpu.flash_attn ).toBeUndefined()
        expect( cpu ).toMatchObject( { flash_attn: true, cache_type_k: `q8_0`, cache_type_v: `q8_0`, n_ubatch: 128 } )
        expect( cpu.n_ubatch ).toBeLessThanOrEqual( cpu.n_batch )
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

        // GPU, then CPU with q8_0 KV, then CPU with f16 KV
        expect( mocks.instances ).toHaveLength( 3 )
        expect( mocks.instances[ 2 ].load_options.cache_type_k ).toBe( `f16` )
    } )

    test( `concurrent loads run one after another instead of disposing each other`, async () => {
        mocks.probed = false
        mocks.load_delay_ms = 30
        const provider = new WllamaProvider()

        await Promise.all( [
            provider.load_model( `smollm2-360m-q4km` ),
            provider.load_model( `smollm2-360m-q4km` ),
        ] )

        // The second call finds the first runtime ready and keeps it
        expect( mocks.instances ).toHaveLength( 1 )
        expect( provider.is_ready() ).toBe( true )
    } )

    test( `an unload during a load fails it clearly instead of crashing`, async () => {
        mocks.probed = false
        mocks.load_delay_ms = 50
        const provider = new WllamaProvider()

        const loading = provider.load_model( `smollm2-360m-q4km` )
        await new Promise( resolve => setTimeout( resolve, 20 ) )
        await provider.unload_model()

        await expect( loading ).rejects.toThrow( /interrupted/i )
    } )

    test( `an unload during the f16 retry window does not resurrect the model`, async () => {
        mocks.probed = false
        mocks.fail_quantized_kv = true
        const provider = new WllamaProvider()

        const loading = provider.load_model( `smollm2-360m-q4km` )
        // The q8_0 attempt fails at once; unload inside the 50 ms retry gap
        await new Promise( resolve => setTimeout( resolve, 20 ) )
        await provider.unload_model()

        await expect( loading ).rejects.toThrow( /interrupted/i )
        expect( provider.is_ready() ).toBe( false )
    } )

    test( `an unload releases a load whose worker never answers`, async () => {
        mocks.probed = false
        mocks.load_hangs = true
        const provider = new WllamaProvider()

        const loading = provider.load_model( `smollm2-360m-q4km` )
        await new Promise( resolve => setTimeout( resolve, 20 ) )
        await provider.unload_model()
        await expect( loading ).rejects.toThrow( /interrupted/i )

        // The queue is free: the next load runs immediately
        mocks.load_hangs = false
        await provider.load_model( `smollm2-360m-q4km` )
        expect( provider.is_ready() ).toBe( true )
    } )

    test( `retries CPU loads with f16 KV when the quantized cache is rejected`, async () => {
        mocks.fail_gpu = true
        mocks.fail_quantized_kv = true
        const provider = new WllamaProvider()

        await provider.load_model( `smollm2-360m-q4km` )

        const cpu_attempts = mocks.instances.slice( 1 ).map( ( { load_options } ) => load_options.cache_type_k )
        expect( cpu_attempts ).toEqual( [ `q8_0`, `f16` ] )
        expect( provider.is_ready() ).toBe( true )
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


    describe( `vision projector`, () => {

        const model_blob = { size: 500_000_000 }
        const projector_blob = { size: 200_000_000, is_projector: true }
        const vision_model = () => ( {
            id: `custom-vision`,
            blob: model_blob,
            file_size_bytes: 500_000_000,
            vision: true,
            mmproj: { file_name: `mmproj-F16.gguf`, file_size_bytes: 200_000_000 },
        } )

        test( `loads model and projector together with image-sized batches`, async () => {
            mocks.cached_model = vision_model()
            mocks.projector = { open: async () => [ projector_blob ] }

            const provider = new WllamaProvider()
            await provider.load_model( `custom-vision` )

            const [ runtime ] = mocks.instances.slice( -1 )
            expect( runtime.source ).toEqual( [ model_blob, projector_blob ] )
            expect( runtime.load_options.image_max_tokens ).toBeGreaterThan( 0 )
            expect( runtime.load_options.n_ubatch ).toBeGreaterThanOrEqual( runtime.load_options.image_max_tokens )
            expect( runtime.load_options.n_batch ).toBeGreaterThanOrEqual( runtime.load_options.image_max_tokens )
            expect( runtime.load_options.n_ctx ).toBeGreaterThanOrEqual( 4096 )
            expect( provider.get_capabilities() ).toMatchObject( { image_input: true, image_blocked: null } )
        } )

        test( `a missing projector keeps text chat and says what is missing`, async () => {
            mocks.cached_model = vision_model()

            const provider = new WllamaProvider()
            await provider.load_model( `custom-vision` )

            expect( mocks.instances.at( -1 ).source ).toEqual( [ model_blob ] )
            expect( provider.get_capabilities() ).toMatchObject( { image_input: false, image_blocked: `projector_missing` } )
            await expect( provider.chat( [ { role: `user`, content: `hi` } ] ) ).resolves.toBe( `cpu answer` )

            // History images from an earlier vision model become a note, not an error
            await expect( provider.chat( [ { role: `user`, content: `hi`, attachments: [ { kind: `image`, data: new Blob( [ `x` ] ) } ] } ] ) )
                .resolves.toBe( `cpu answer` )
            expect( mocks.last_messages ).toEqual( [ { role: `user`, content: `[1 earlier image omitted]\nhi` } ] )
        } )

        test( `drops the projector when memory only fits the text model`, async () => {
            mocks.cached_model = vision_model()
            mocks.projector = { open: async () => [ projector_blob ] }
            mocks.memory_budget = 1_100_000_000

            const provider = new WllamaProvider()
            await provider.load_model( `custom-vision` )

            expect( mocks.instances.at( -1 ).source ).toEqual( [ model_blob ] )
            expect( mocks.instances.at( -1 ).load_options.image_max_tokens ).toBeUndefined()
            expect( provider.get_capabilities() ).toMatchObject( { image_input: false, image_blocked: `memory` } )
        } )

    } )

} )
