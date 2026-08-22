import { describe, expect, test } from 'vitest'
import {
    BROWSER_AUTOMATIC_MODEL_CEILING_BYTES,
    MEMORY64_MODEL_CEILING_BYTES,
    WASM32_MODEL_CEILING_BYTES,
    estimate_max_model_bytes,
} from '../../src/utils/device_detection'
import {
    MODEL_CATALOG,
    benchmark_coverage,
    estimate_model_memory,
    get_model_by_id,
    quality_score,
    select_browser_batch,
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

const ALL_BROWSER_VERIFIED_IDS = [
    `gpt-oss-20b-mxfp4`,
    `ministral3-14b-q4km`,
    `ministral3-3b-q4km`,
    `qwen35-2b-q4km`,
    `qwen35-4b-q4km`,
    `qwen35-9b-vision-q4km`,
]

describe( `model selection`, () => {

    test( `keeps every catalog ID unique`, () => {
        const ids = MODEL_CATALOG.map( model => model.id )
        expect( new Set( ids ).size ).toBe( ids.length )
    } )

    test( `pins the exact browser-verified artifacts`, () => {
        for( const [ id, expected ] of Object.entries( VERIFIED_MODELS ) ) {
            const model = get_model_by_id( id )
            expect( model ).toMatchObject( {
                browser_verified: true,
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
        expect( select_model_options( automatic_budget ).smarter.id ).toBe( `phi-4-mini-q4km` )
        expect( BROWSER_AUTOMATIC_MODEL_CEILING_BYTES ).toBe( automatic_budget )
        expect( MEMORY64_MODEL_CEILING_BYTES ).toBe( 15_000_000_000 )
        expect( WASM32_MODEL_CEILING_BYTES ).toBe( 3_400_000_000 )
    } )

    test( `does not let one published benchmark dominate complete coverage`, () => {
        const sparse = get_model_by_id( `qwen35-4b-q4km` )
        const complete = get_model_by_id( `qwen3-4b-q4km` )

        expect( quality_score( sparse ) ).toBeCloseTo( 55.24 )
        expect( quality_score( complete ) ).toBeCloseTo( 63.06 )
        expect( quality_score( sparse ) ).toBeLessThan( quality_score( complete ) )
        expect( benchmark_coverage( sparse ) ).toBe( 1 )
        expect( benchmark_coverage( complete ) ).toBe( 5 )
    } )

    test( `tracks the complete browser-verified artifact set`, () => {
        const verified_ids = MODEL_CATALOG
            .filter( model => model.browser_verified === true )
            .map( model => model.id )
            .sort()

        expect( verified_ids ).toEqual( ALL_BROWSER_VERIFIED_IDS )
    } )

    test( `shrinks prompt batches at the measured large-model thresholds`, () => {
        expect( select_browser_batch( 2_740_937_888, 2 ) ).toBe( 512 )
        expect( select_browser_batch( 5_680_522_464, 2 ) ).toBe( 256 )
        expect( select_browser_batch( 12_109_566_624, 2 ) ).toBe( 128 )
    } )

} )
