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
    can_fit_in_memory,
    decode_bytes,
    estimate_model_memory,
    get_model_by_id,
    has_fewer_refusals,
    has_image_input,
    model_download_bytes,
    quality_score,
    select_browser_batch,
    select_browser_context,
    select_for_preferences,
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
    `granite4-h-1b-q4km`,
    `granite4-h-tiny-q4km`,
    `ministral3-14b-q4km`,
    `ministral3-3b-q4km`,
    `qwen3-1.7b-decensored-tpn-q4km`,
    `qwen35-0.8b-tpn-q5km`,
    `qwen35-2b-q4km`,
    `qwen35-4b-heresy-tpn-q4km`,
    `qwen35-4b-q4km`,
    `qwen35-4b-tpn-q4km`,
    `qwen35-9b-heretic-tpn-q4km`,
    `qwen35-9b-tpn-q4km`,
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

    test( `gives the legacy Qwen 3.5 "vision" ID a real projector`, () => {
        const model = get_model_by_id( `qwen35-9b-vision-q4km` )
        expect( has_image_input( model ) ).toBe( true )
        expect( model.reasoning_enabled ).toBe( false )
        expect( model_download_bytes( model ) ).toBe( 5_680_522_464 + 918_166_080 )
    } )

    test( `keeps retired models loadable but out of every pick`, () => {
        const retired = MODEL_CATALOG.filter( model => model.hidden )
        expect( retired.length ).toBeGreaterThan( 0 )
        retired.forEach( model => expect( get_model_by_id( model.id ) ).toBe( model ) )
        expect( get_model_by_id( `smollm2-360m-q4km` ).hidden ).toBe( true )
    } )

    test( `curates every offered local model`, () => {
        const offered = MODEL_CATALOG.filter( model => !model.hidden && !model.cloud_only )
        offered.forEach( model => {

            // Product policy: only TPN-optimised builds are offered
            expect( model.hugging_face_repo, model.id ).toMatch( /^tpnlabs\// )
            // null only where TPN's own reference run was broken (Gemma 4)
            if( model.tpn.kld !== null ) expect( model.tpn.kld, model.id ).toBeGreaterThan( 0 )
            expect( model.tpn.report, model.id ).toMatch( /^https:\/\/bench\.trueperformancenetwork\.com\/r\// )

            expect( model.quality, model.id ).toBeGreaterThan( 0 )
            if( model.vision ) expect( model.mmproj?.file_size_bytes, model.id ).toBeGreaterThan( 0 )
            if( model.uncensored ) expect( has_fewer_refusals( model ), model.id ).toBe( true )
        } )
    } )

    test( `keeps automatic browser recommendations conservative`, () => {
        const reported_eight_gb = {
            runtime: `browser`,
            wasm: { memory64: true },
            memory: { device_memory: 8 },
        }
        const automatic_budget = estimate_max_model_bytes( reported_eight_gb )

        expect( automatic_budget ).toBe( 5_600_000_000 )
        expect( BROWSER_AUTOMATIC_MODEL_CEILING_BYTES ).toBe( automatic_budget )
        expect( MEMORY64_MODEL_CEILING_BYTES ).toBe( 15_000_000_000 )
        expect( WASM32_MODEL_CEILING_BYTES ).toBe( 3_400_000_000 )
    } )

    test( `does not recreate a 2GB wall from clamped Memory64 device memory`, () => {
        const reported_four_gb = {
            runtime: `browser`,
            wasm: { memory64: true },
            memory: { device_memory: 4 },
        }

        expect( estimate_max_model_bytes( reported_four_gb ) ).toBe( BROWSER_AUTOMATIC_MODEL_CEILING_BYTES )
        expect( can_fit_in_memory(
            get_model_by_id( `qwen35-4b-q4km` ),
            estimate_max_model_bytes( reported_four_gb ),
        ) ).toBe( true )
    } )

    test( `returns no recommendation when even the smallest runtime cannot fit`, () => {
        const device = { runtime: `browser`, ceiling_bytes: 500_000_000, budget_bytes: 500_000_000, automatic_bytes: 500_000_000, bandwidth_gbs: 5 }
        expect( select_for_preferences( MODEL_CATALOG, device ) ).toEqual( { pick: null, fit: null, fallback: null, relaxed: [] } )
    } )

    test( `keeps transformer block counts separate from hybrid KV layers`, () => {
        expect( get_model_by_id( `qwen35-2b-q4km` ) ).toMatchObject( {
            layers: 6,
            block_count: 24,
        } )
        expect( get_model_by_id( `qwen35-4b-q4km` ) ).toMatchObject( {
            layers: 8,
            block_count: 32,
        } )
    } )

    test( `prefers the curated index, else does not let one benchmark dominate`, () => {
        const curated = get_model_by_id( `qwen35-4b-q4km` )
        const sparse = { ...curated, quality: undefined }
        const complete = get_model_by_id( `qwen3-4b-q4km` )

        expect( quality_score( curated ) ).toBe( 79 )
        expect( quality_score( sparse ) ).toBeCloseTo( 55.24 )
        expect( quality_score( complete ) ).toBeCloseTo( 63.06 )
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

    test( `scales MoE decode bytes by the active-parameter fraction`, () => {
        const moe = get_model_by_id( `granite4-h-tiny-q4km` )
        const dense = get_model_by_id( `granite4-h-micro-q4km` )

        expect( decode_bytes( dense ) ).toBe( dense.file_size_bytes )
        expect( decode_bytes( moe ) ).toBe( Math.round( 4_230_976_352 * 1_000_000_000 / 6_939_037_248 ) )
        expect( decode_bytes( moe ) ).toBeLessThan( decode_bytes( dense ) )
    } )

    test( `caps sliding-window KV at the window instead of the context`, () => {
        const gemma = get_model_by_id( `gemma4-26b-a4b-iq4xs` )
        const full_per_token = 2 * 5 * 2 * 512 * 2
        const sliding = 2 * 25 * 8 * 256 * ( 1_024 + 512 ) * 2

        expect( estimate_model_memory( gemma, 4_096 ) - estimate_model_memory( gemma, 2_048 ) )
            .toBe( full_per_token * 2_048 )
        expect( estimate_model_memory( gemma, 2_048 ) )
            .toBe( gemma.file_size_bytes + full_per_token * 2_048 + sliding + 500_000_000 )
    } )

    test( `keeps the large MoE additions inside the Memory64 budget at 16K`, () => {
        for( const id of [ `gemma4-26b-a4b-iq4xs`, `qwen36-35b-a3b-iq3xxs` ] ) {
            const model = get_model_by_id( id )
            expect( model.moe ).toBe( true )
            expect( model.reasoning_enabled ).toBe( false )
            expect( select_browser_context( model, MEMORY64_MODEL_CEILING_BYTES ) ).toBe( 16_384 )
        }
    } )

    test( `shrinks prompt batches at the measured large-model thresholds`, () => {
        expect( select_browser_batch( 2_740_937_888, 2 ) ).toBe( 512 )
        expect( select_browser_batch( 5_680_522_464, 2 ) ).toBe( 256 )
        expect( select_browser_batch( 12_109_566_624, 2 ) ).toBe( 128 )
    } )

} )
