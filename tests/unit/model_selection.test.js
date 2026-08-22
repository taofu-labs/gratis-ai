import { describe, expect, test } from 'vitest'
import {
    MEMORY64_MODEL_CEILING_BYTES,
    WASM32_MODEL_CEILING_BYTES,
    estimate_max_model_bytes,
} from '../../src/utils/device_detection'
import {
    MODEL_CATALOG,
    estimate_model_memory,
    get_model_by_id,
    select_model_options,
} from '../../src/utils/model_catalog'

const VERIFIED_MODELS = {
    'ministral3-3b-q4km': {
        bytes: 2_146_497_824,
        repo: `unsloth/Ministral-3-3B-Instruct-2512-GGUF`,
    },
    'qwen35-4b-q4km': {
        bytes: 2_740_937_888,
        repo: `unsloth/Qwen3.5-4B-GGUF`,
    },
    'qwen35-9b-vision-q4km': {
        bytes: 5_680_522_464,
        repo: `unsloth/Qwen3.5-9B-GGUF`,
    },
    'ministral3-14b-q4km': {
        bytes: 8_239_067_840,
        repo: `unsloth/Ministral-3-14B-Instruct-2512-GGUF`,
    },
    'gpt-oss-20b-mxfp4': {
        bytes: 12_109_566_624,
        repo: `ggml-org/gpt-oss-20b-GGUF`,
    },
}

describe( `model selection`, () => {

    test( `keeps every catalog ID unique`, () => {
        const ids = MODEL_CATALOG.map( model => model.id )
        expect( new Set( ids ).size ).toBe( ids.length )
    } )

    test( `pins the exact browser-verified artifacts`, () => {
        for( const [ id, expected ] of Object.entries( VERIFIED_MODELS ) ) {
            const model = get_model_by_id( id )
            expect( model ).toMatchObject( {
                file_size_bytes: expected.bytes,
                hugging_face_repo: expected.repo,
            } )
            expect( estimate_model_memory( model ) ).toBeLessThanOrEqual( MEMORY64_MODEL_CEILING_BYTES )
        }
    } )

    test( `treats Qwen 3.5 language weights as text-only`, () => {
        const model = get_model_by_id( `qwen35-9b-vision-q4km` )
        expect( model.vision ).toBe( false )
        expect( model.reasoning_enabled ).toBe( false )
    } )

    test( `keeps automatic browser recommendations conservative`, () => {
        const reported_eight_gb = {
            runtime: `browser`,
            wasm: { memory64: true },
            memory: { device_memory: 8 },
        }
        const automatic_budget = estimate_max_model_bytes( reported_eight_gb )

        expect( automatic_budget ).toBe( 5_600_000_000 )
        expect( select_model_options( automatic_budget ).smarter.id ).toBe( `qwen35-4b-q4km` )
        expect( MEMORY64_MODEL_CEILING_BYTES ).toBe( 15_000_000_000 )
        expect( WASM32_MODEL_CEILING_BYTES ).toBe( 3_400_000_000 )
    } )

} )
