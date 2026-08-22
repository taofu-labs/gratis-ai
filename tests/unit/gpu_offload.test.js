import { describe, expect, test } from 'vitest'
import { select_gpu_offload_layers } from '../../src/utils/gpu_offload'

const GIB = 1024 ** 3

const MODEL = {
    file_size_bytes: GIB,
    block_count: 20,
    layers: 20,
    kv_heads: 4,
    head_dim: 64,
}

describe( `GPU layer selection`, () => {

    test( `uses full offload only when measured GPU and RAM slack cover it`, () => {
        expect( select_gpu_offload_layers( {
            model: MODEL,
            gpu_probe: { status: `measured`, measured_bytes: 4 * GIB },
            ram_budget_bytes: 5 * GIB,
            context_length: 2048,
        } ) ).toBe( 99_999 )
    } )

    test( `selects a positive partial layer count from a smaller probe`, () => {
        const layers = select_gpu_offload_layers( {
            model: MODEL,
            gpu_probe: { status: `measured`, measured_bytes: GIB },
            ram_budget_bytes: 5 * GIB,
            context_length: 2048,
        } )

        expect( layers ).toBe( 6 )
    } )

    test( `never trusts reported hints or unknown block counts`, () => {
        expect( select_gpu_offload_layers( {
            model: MODEL,
            gpu_probe: { status: `reported`, measured_bytes: 8 * GIB },
            ram_budget_bytes: 5 * GIB,
            context_length: 2048,
        } ) ).toBe( 0 )

        expect( select_gpu_offload_layers( {
            model: { ...MODEL, block_count: undefined },
            gpu_probe: { status: `measured`, measured_bytes: 8 * GIB },
            ram_budget_bytes: 5 * GIB,
            context_length: 2048,
        } ) ).toBe( 0 )
    } )

    test( `does not spend GPU bytes when full-model RAM has no slack`, () => {
        expect( select_gpu_offload_layers( {
            model: MODEL,
            gpu_probe: { status: `measured`, measured_bytes: 8 * GIB },
            ram_budget_bytes: 1.2 * GIB,
            context_length: 2048,
        } ) ).toBe( 0 )
    } )

} )
