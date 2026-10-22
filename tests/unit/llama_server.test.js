import { describe, expect, test } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import {
    build_request_body,
    build_server_args,
    create_sse_parser,
    resolve_server_binary,
    to_data_uri,
    to_openai_messages,
} from '../../electron/llama_server.js'
import { has_gguf_magic, mmproj_local_name } from '../../electron/model_files.js'
import { to_ipc_messages } from '../../src/providers/electron_ipc_provider.js'

const png_bytes = new Uint8Array( [ 0x89, 0x50, 0x4e, 0x47 ] )

describe( `llama-server sidecar helpers`, () => {

    test( `builds a private, vision-ready command line`, () => {

        const args = build_server_args( { model_path: `/m.gguf`, mmproj_path: `/p.gguf`, n_ctx: 8192, port: 4321, api_key: `secret` } )
        const value = ( flag ) => args[ args.indexOf( flag ) + 1 ]

        expect( value( `--model` ) ).toBe( `/m.gguf` )
        expect( value( `--mmproj` ) ).toBe( `/p.gguf` )
        expect( value( `--ctx-size` ) ).toBe( `8192` )
        expect( value( `--host` ) ).toBe( `127.0.0.1` )
        expect( value( `--port` ) ).toBe( `4321` )
        expect( value( `--api-key` ) ).toBe( `secret` )
        expect( value( `--reasoning-format` ) ).toBe( `none` )
        expect( args ).toContain( `--jinja` )
        expect( args ).not.toContain( `--device` )

    } )

    test( `CPU fallback disables every GPU backend`, () => {
        const args = build_server_args( { model_path: `/m`, mmproj_path: `/p`, n_ctx: 512, port: 1, api_key: `k`, cpu_only: true } )
        expect( args.slice( args.indexOf( `--device` ), args.indexOf( `--device` ) + 2 ) ).toEqual( [ `--device`, `none` ] )
        expect( args ).toContain( `--no-mmproj-offload` )
    } )

    test( `resolves the binary per platform, packaged or dev`, () => {

        expect( resolve_server_binary( { is_packaged: true, resources_path: `/r`, app_root: `/a`, platform: `win32`, arch: `x64`, env: {} } ) )
            .toBe( path.join( `/r`, `llama-server`, `llama-server.exe` ) )
        expect( resolve_server_binary( { is_packaged: false, resources_path: `/r`, app_root: `/a`, platform: `darwin`, arch: `arm64`, env: {} } ) )
            .toBe( path.join( `/a`, `vendor`, `llama-server`, `mac-arm64`, `llama-server` ) )
        expect( resolve_server_binary( { is_packaged: true, env: { GRATIS_LLAMA_SERVER: `/custom` } } ) ).toBe( `/custom` )

    } )

    test( `converts image attachments to OpenAI content parts`, () => {

        const messages = to_openai_messages( [
            { role: `system`, content: `Be brief` },
            { role: `user`, content: `What is this?`, attachments: [
                { kind: `image`, mime: `image/png`, name: `a.png`, data: png_bytes.buffer },
                { kind: `document`, name: `x.pdf`, pages: 2 },
            ] },
            { role: `assistant`, content: `A PNG` },
        ] )

        expect( messages[ 0 ] ).toEqual( { role: `system`, content: `Be brief` } )
        expect( messages[ 1 ].content ).toEqual( [
            { type: `image_url`, image_url: { url: `data:image/png;base64,iVBORw==` } },
            { type: `text`, text: `What is this?` },
        ] )
        expect( messages[ 2 ] ).toEqual( { role: `assistant`, content: `A PNG` } )

    } )

    test( `keeps plain strings for text-only and document-only turns`, () => {
        const [ message ] = to_openai_messages( [ { role: `user`, content: `<document name="x">hi</document>`, attachments: [ { kind: `document`, name: `x` } ] } ] )
        expect( message ).toEqual( { role: `user`, content: `<document name="x">hi</document>` } )
    } )

    test( `data URIs accept bytes or existing URIs`, () => {
        expect( to_data_uri( png_bytes, `image/jpeg` ) ).toBe( `data:image/jpeg;base64,iVBORw==` )
        expect( to_data_uri( `data:image/png;base64,AAAA` ) ).toBe( `data:image/png;base64,AAAA` )
    } )

    test( `request body maps app sampling options and thinking default`, () => {

        const body = build_request_body( [ { role: `user`, content: `hi` } ], { temperature: 0.2, seed: -1, stop_sequences: [ `###` ] }, { reasoning_enabled: false } )

        expect( body ).toMatchObject( {
            stream: true,
            return_progress: true,
            temperature: 0.2,
            max_tokens: 2048,
            repeat_penalty: 1.1,
            stop: [ `###` ],
            chat_template_kwargs: { enable_thinking: false },
        } )
        expect( body ).not.toHaveProperty( `seed` )
        expect( build_request_body( [], {} ) ).not.toHaveProperty( `chat_template_kwargs` )

    } )

    test( `SSE parser handles split lines and [DONE]`, () => {

        const payloads = []
        const feed = create_sse_parser( ( payload ) => payloads.push( payload ) )

        feed( `data: {"choices":[{"delta":{"content":"Hel` )
        feed( `lo"}}]}\n\n: ping\n\ndata: {"timings":{"predicted_n":2}}\r\n\ndata: [DONE]\n\n` )

        expect( payloads ).toEqual( [
            { choices: [ { delta: { content: `Hello` } } ] },
            { timings: { predicted_n: 2 } },
        ] )

    } )

} )

describe( `model files`, () => {

    test( `projectors get a per-model name`, () => {
        expect( mmproj_local_name( `Qwen3.5-2B-Q4_K_M.gguf`, `mmproj-F16.gguf` ) ).toBe( `Qwen3.5-2B-Q4_K_M.mmproj-F16.gguf` )
    } )

    test( `GGUF magic check rejects HTML error pages`, () => {
        const dir = mkdtempSync( path.join( tmpdir(), `gguf-` ) )
        writeFileSync( path.join( dir, `ok.gguf` ), `GGUF\x03\x00` )
        writeFileSync( path.join( dir, `bad.gguf` ), `<!DOCTYPE html>` )
        expect( has_gguf_magic( path.join( dir, `ok.gguf` ) ) ).toBe( true )
        expect( has_gguf_magic( path.join( dir, `bad.gguf` ) ) ).toBe( false )
        expect( has_gguf_magic( path.join( dir, `missing.gguf` ) ) ).toBe( false )
    } )

} )

describe( `Electron IPC message preparation`, () => {

    test( `turns image Blobs into ArrayBuffers for vision models`, async () => {

        const blob = new Blob( [ png_bytes ], { type: `image/png` } )
        const [ message ] = await to_ipc_messages( [ { role: `user`, content: `hi`, attachments: [ { kind: `image`, mime: `image/png`, name: `a.png`, data: blob } ] } ], true )

        expect( message.attachments[ 0 ].data ).toBeInstanceOf( ArrayBuffer )
        expect( new Uint8Array( message.attachments[ 0 ].data ) ).toEqual( png_bytes )

    } )

    test( `drops attachments for text-only models`, async () => {
        const [ message ] = await to_ipc_messages( [ { role: `user`, content: `hi`, attachments: [ { kind: `image`, data: new Blob() } ] } ], false )
        expect( message ).toEqual( { role: `user`, content: `hi` } )
    } )

} )
