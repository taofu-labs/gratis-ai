import { afterEach, describe, expect, test, vi } from 'vitest'
import { build_gguf_skeleton, parse_gguf_header } from '../../src/utils/gguf_skeleton'
import { build_device_profile, estimate_max_model_bytes } from '../../src/utils/device_detection'
import { MODEL_CATALOG, estimate_decode_speed, format_tokens_per_second } from '../../src/utils/model_catalog'
import { calibrated_speed_ratio, has_speed_probe, record_speed_ratio } from '../../src/utils/speed_calibration'
import { SPEED_REFERENCE_ID } from '../../src/utils/speed_probe'

// ── A tiny hand-written GGUF: 4 blocks, the last one a multi-token-prediction block ──

const encoder = new TextEncoder()
const u32 = value => new Uint8Array( new Uint32Array( [ value ] ).buffer )
const u64 = value => new Uint8Array( new BigUint64Array( [ BigInt( value ) ] ).buffer )
const str = value => [ u64( encoder.encode( value ).length ), encoder.encode( value ) ]
const concat = parts => {
    const flat = parts.flat( Infinity )
    const out = new Uint8Array( flat.reduce( ( total, part ) => total + part.length, 0 ) )
    flat.reduce( ( at, part ) => ( out.set( part, at ), at + part.length ), 0 )
    return out
}

const TENSOR_BYTES = 64
const TENSORS = [ `token_embd.weight`, `blk.0.w`, `blk.1.w`, `blk.2.w`, `blk.3.w`, `blk.3.nextn.eh_proj.weight`, `output_norm.weight` ]

const tiny_gguf = () => {
    const kv = [
        [ str( `general.architecture` ), u32( 8 ), str( `toy` ) ],
        [ str( `toy.block_count` ), u32( 4 ), u32( 4 ) ],
        [ str( `toy.nextn_predict_layers` ), u32( 4 ), u32( 1 ) ],
        [ str( `toy.attention.recurrent_layers` ), u32( 9 ), u32( 7 ), u64( 4 ), new Uint8Array( [ 1, 1, 0, 1 ] ) ],
    ]
    const infos = TENSORS.map( ( name, i ) => [ str( name ), u32( 1 ), u64( TENSOR_BYTES / 4 ), u32( 0 ), u64( i * TENSOR_BYTES ) ] )
    const head = concat( [ u32( 0x46554747 ), u32( 3 ), u64( TENSORS.length ), u64( kv.length ), kv, infos ] )
    const padded = Math.ceil( head.length / 32 ) * 32
    return { head, file_bytes: padded + TENSORS.length * TENSOR_BYTES }
}

const kv_value = ( header, key ) => header.kv.find( entry => entry.key === key )

describe( `zero-weight GGUF skeleton`, () => {

    test( `keeps the first blocks, the metadata, and zeroed tensor data`, async () => {
        const { head, file_bytes } = tiny_gguf()
        const skeleton = build_gguf_skeleton( parse_gguf_header( head ), file_bytes, 2 )
        const bytes = new Uint8Array( await skeleton.arrayBuffer() )
        const parsed = parse_gguf_header( bytes )

        expect( kv_value( parsed, `toy.block_count` ).value ).toBe( 2 )
        expect( kv_value( parsed, `general.architecture` ).value ).toBe( `toy` )
        expect( parsed.tensors.map( t => t.name ) ).toEqual( [ `token_embd.weight`, `blk.0.w`, `blk.1.w`, `output_norm.weight` ] )
        expect( parsed.tensors.map( t => t.offset ) ).toEqual( [ 0, 64, 128, 192 ] )
        expect( bytes.length ).toBe( parsed.data_start + 4 * TENSOR_BYTES )
        expect( bytes.subarray( parsed.data_start ).every( byte => byte === 0 ) ).toBe( true )
    } )

    test( `shrinks per-layer arrays and drops multi-token prediction`, () => {
        const { head, file_bytes } = tiny_gguf()
        const skeleton = build_gguf_skeleton( parse_gguf_header( head ), file_bytes, 2 )

        return skeleton.arrayBuffer().then( buffer => {
            const parsed = parse_gguf_header( new Uint8Array( buffer ) )
            const layers = kv_value( parsed, `toy.attention.recurrent_layers` )
            expect( layers.array.count ).toBe( 2 )
            expect( [ ...layers.raw.subarray( -2 ) ] ).toEqual( [ 1, 1 ] )
            expect( kv_value( parsed, `toy.nextn_predict_layers` ).value ).toBe( 0 )
        } )
    } )

    test( `a cut-off header asks for more bytes`, () => {
        const { head } = tiny_gguf()
        expect( () => parse_gguf_header( head.subarray( 0, 100 ) ) ).toThrow( RangeError )
        expect( () => parse_gguf_header( new Uint8Array( 64 ) ) ).toThrow( `Not a GGUF file` )
    } )

} )

// ── Reference table × device ratio ──

const WINDOWS_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36`
const ANDROID_UA = `Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36`
const browser_caps = { runtime: `browser`, wasm: { memory64: true }, memory: { device_memory: 8 } }

const profile = ( ua = WINDOWS_UA, capabilities = browser_caps ) => {
    vi.stubGlobal( `navigator`, { userAgent: ua, maxTouchPoints: ua === ANDROID_UA ? 5 : 0 } )
    return build_device_profile( capabilities, estimate_max_model_bytes( capabilities ) )
}

const stub_storage = () => {
    const store = {}
    vi.stubGlobal( `localStorage`, { getItem: key => store[ key ] ?? null, setItem: ( key, value ) => store[ key ] = value } )
    return store
}

afterEach( () => vi.unstubAllGlobals() )

describe( `decode speed estimate`, () => {

    const measured = MODEL_CATALOG.filter( model => model.browser_tps )
    const [ small ] = measured

    test( `every visible browser build carries a reference speed`, () => {
        const browser_builds = MODEL_CATALOG.filter( model => model.tpn && model.file_size_bytes < 15e9 )
        expect( measured.length ).toBeGreaterThan( 0 )
        browser_builds.forEach( model => expect( model.browser_tps, model.id ).toBeGreaterThan( 0 ) )
    } )

    test( `scales the reference speed by this device's ratio`, () => {
        stub_storage()

        // Before any measurement the bandwidth model guesses
        const unmeasured = { ...small, browser_tps: undefined }
        expect( estimate_decode_speed( small, profile() ) ).toBeCloseTo( estimate_decode_speed( unmeasured, profile() ) )
        expect( profile( ANDROID_UA ).speed_ratio ).toBeNull()

        // The probe measures it, real replies refine it
        record_speed_ratio( 2, { probe: true } )
        expect( has_speed_probe() ).toBe( true )
        expect( estimate_decode_speed( small, profile() ) ).toBeCloseTo( small.browser_tps * 2 )

        record_speed_ratio( 1, { tokens: 64 } )
        expect( calibrated_speed_ratio() ).toBeCloseTo( 1.5 )

        // Short replies teach nothing
        record_speed_ratio( 10, { tokens: 8 } )
        expect( calibrated_speed_ratio() ).toBeCloseTo( 1.5 )
    } )

    test( `a ratio against an older reference table is ignored`, () => {
        const store = stub_storage()
        record_speed_ratio( 3, { probe: true } )
        const [ key ] = Object.keys( store )
        store[ key ] = JSON.stringify( { ...JSON.parse( store[ key ] ), reference: `${ SPEED_REFERENCE_ID }-old` } )

        expect( calibrated_speed_ratio() ).toBeNull()
        expect( has_speed_probe() ).toBe( false )
    } )

    test( `native runtimes and unmeasured models keep the bandwidth model`, () => {
        stub_storage()
        const electron = profile( ``, { runtime: `electron`, gpu: {}, memory: { total_bytes: 16e9 } } )
        const unmeasured = { ...small, browser_tps: undefined }

        expect( estimate_decode_speed( small, electron ) ).not.toBeCloseTo( small.browser_tps )
        expect( estimate_decode_speed( unmeasured, profile() ) ).toBeGreaterThan( 0 )
        expect( estimate_decode_speed( unmeasured, profile() ) ).not.toBeCloseTo( small.browser_tps )
    } )

    test( `the phone apps rank repackable K-quants above legacy Q5_0 of the same size`, () => {
        stub_storage()
        const phone = profile( ANDROID_UA, { runtime: `electron`, platform: `android`, gpu: {}, memory: { total_bytes: 8e9, free_bytes: 3e9 } } )
        const desktop = profile( ``, { runtime: `electron`, platform: `linux`, gpu: {}, memory: { total_bytes: 16e9 } } )
        const k_quant = { ...small, browser_tps: undefined, quantization: `Q4_K_M` }
        const legacy = { ...k_quant, quantization: `Q5_0+` }

        expect( estimate_decode_speed( legacy, phone ) ).toBeLessThan( estimate_decode_speed( k_quant, phone ) )
        expect( estimate_decode_speed( legacy, desktop ) ).toBeCloseTo( estimate_decode_speed( k_quant, desktop ) )
    } )

    test( `formats for display`, () => {
        expect( format_tokens_per_second( 0.42 ) ).toBe( `~0.4 tok/s` )
        expect( format_tokens_per_second( 3.456 ) ).toBe( `~3.5 tok/s` )
        expect( format_tokens_per_second( 23.6 ) ).toBe( `~24 tok/s` )
    } )

} )
