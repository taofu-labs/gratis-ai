import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
    classify_webgpu_adapter,
    get_webgpu_memory_probe,
    measure_webgpu_allocatable_bytes,
    reset_webgpu_memory_probe,
    select_webgpu_probe_target,
    wait_for_existing_webgpu_memory_probe,
} from '../../src/utils/webgpu_memory'

const MIB = 1024 ** 2
const GIB = 1024 ** 3

const create_fake_gpu = ( {
    allocation_limit = Infinity,
    fallback = false,
    lose_after_submissions = null,
} = {} ) => {

    let allocated = 0
    let pending_memory_error = null
    let pending_validation_error = null
    const buffers = []
    const destroy_device = vi.fn()
    const request_device = vi.fn()
    let lose_device
    let submission_count = 0

    const device = {
        lost: new Promise( resolve => {
            lose_device = resolve
        } ),
        pushErrorScope: vi.fn(),
        popErrorScope: vi.fn( async () => {
            if( pending_validation_error ) {
                const error = pending_validation_error
                pending_validation_error = null
                return error
            }
            const error = pending_memory_error
            pending_memory_error = null
            return error
        } ),
        createBuffer: vi.fn( ( { size } ) => {
            const valid = allocated + size <= allocation_limit
            if( valid ) allocated += size
            else pending_memory_error = new Error( `out of memory` )

            const buffer = {
                valid,
                destroy: vi.fn(),
            }
            buffers.push( buffer )
            return buffer
        } ),
        createCommandEncoder: vi.fn( () => ( {
            clearBuffer: buffer => {
                if( !buffer.valid ) pending_validation_error = new Error( `invalid buffer` )
            },
            finish: () => ( {} ),
        } ) ),
        queue: {
            submit: vi.fn(),
            onSubmittedWorkDone: vi.fn( async () => {
                submission_count++
                if( submission_count === lose_after_submissions ) {
                    lose_device( { reason: `unknown` } )
                }
            } ),
        },
        destroy: destroy_device,
    }

    request_device.mockResolvedValue( device )

    const adapter = {
        info: {
            vendor: fallback ? `swiftshader` : `nvidia`,
            isFallbackAdapter: fallback,
        },
        limits: { maxBufferSize: 256 * MIB },
        requestDevice: request_device,
    }

    const gpu = { requestAdapter: vi.fn( async () => adapter ) }
    return { gpu, buffers, destroy_device, request_device }

}

describe( `WebGPU memory probing`, () => {

    beforeEach( reset_webgpu_memory_probe )

    test( `retains, refines, and destroys allocations after browser refusal`, async () => {
        const fake = create_fake_gpu( { allocation_limit: 320 * MIB } )
        let tick = 0

        const result = await measure_webgpu_allocatable_bytes( {
            gpu: fake.gpu,
            max_bytes: 512 * MIB,
            now: () => tick++,
        } )

        expect( result ).toMatchObject( {
            measured_bytes: 320 * MIB,
            status: `measured`,
            reason: `allocation_refused`,
        } )
        expect( fake.buffers.filter( buffer => buffer.valid ) ).toHaveLength( 2 )
        expect( fake.buffers.every( buffer => buffer.destroy.mock.calls.length === 1 ) ).toBe( true )
        expect( fake.destroy_device ).toHaveBeenCalledOnce()
    } )

    test( `skips software fallback adapters without requesting a device`, async () => {
        const fake = create_fake_gpu( { fallback: true } )
        const result = await measure_webgpu_allocatable_bytes( {
            gpu: fake.gpu,
            max_bytes: GIB,
        } )

        expect( result ).toMatchObject( { status: `skipped`, reason: `fallback_adapter` } )
        expect( fake.request_device ).not.toHaveBeenCalled()
    } )

    test( `deduplicates concurrent probes and caches the lower bound`, async () => {
        const fake = create_fake_gpu()
        const options = { gpu: fake.gpu, max_bytes: 256 * MIB }

        const [ first, second ] = await Promise.all( [
            get_webgpu_memory_probe( options ),
            get_webgpu_memory_probe( options ),
        ] )
        const third = await get_webgpu_memory_probe( options )

        expect( first ).toBe( second )
        expect( third ).toBe( first )
        expect( fake.gpu.requestAdapter ).toHaveBeenCalledOnce()
    } )

    test( `does not trust allocations that destabilize the device`, async () => {
        const fake = create_fake_gpu( { lose_after_submissions: 2 } )
        const result = await measure_webgpu_allocatable_bytes( {
            gpu: fake.gpu,
            max_bytes: 512 * MIB,
        } )

        expect( result ).toMatchObject( {
            measured_bytes: 256 * MIB,
            status: `unavailable`,
            reason: `device_lost`,
            capped: true,
        } )
        expect( fake.destroy_device ).toHaveBeenCalledOnce()
    } )

    test( `keeps confirmed allocations when the overall probe budget expires`, async () => {
        const fake = create_fake_gpu()
        const times = [ 0, 1, 2, 3, 4 ]
        const result = await measure_webgpu_allocatable_bytes( {
            gpu: fake.gpu,
            max_bytes: 512 * MIB,
            timeout_ms: 4,
            now: () => times.shift() ?? 4,
        } )

        expect( result ).toMatchObject( {
            measured_bytes: 256 * MIB,
            status: `measured`,
            reason: `budget_exhausted`,
            capped: true,
        } )
    } )

    test( `lets model loading join an in-flight probe without starting one`, async () => {
        const fake = create_fake_gpu()
        const running = get_webgpu_memory_probe( { gpu: fake.gpu, max_bytes: 256 * MIB } )
        const existing = wait_for_existing_webgpu_memory_probe()

        await expect( existing ).resolves.toBe( await running )
        expect( fake.gpu.requestAdapter ).toHaveBeenCalledOnce()
    } )

    test( `uses the shared-memory cap unless an adapter is positively discrete`, () => {
        expect( classify_webgpu_adapter( { vendor: `nvidia` } ) ).toBe( `discrete` )
        expect( classify_webgpu_adapter( { vendor: `apple` } ) ).toBe( `shared_or_unknown` )

        expect( select_webgpu_probe_target( {
            ram_budget_bytes: 8 * GIB,
            device_memory_gb: 8,
            adapter_info: { vendor: `apple` },
        } ) ).toBe( 2 * GIB )

        expect( select_webgpu_probe_target( {
            ram_budget_bytes: 8 * GIB,
            device_memory_gb: 8,
            adapter_info: { vendor: `nvidia` },
        } ) ).toBe( Math.floor( 8 * GIB * 0.4 ) )
    } )

} )
