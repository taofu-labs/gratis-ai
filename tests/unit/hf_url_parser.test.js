import { describe, expect, test, vi } from 'vitest'
import { can_fit_in_memory } from '../../src/utils/model_catalog'
import { parse_hf_url, resolve_hf_model } from '../../src/utils/hf_url_parser'

const json_response = data => ( {
    ok: true,
    json: async () => data,
} )

describe( `Hugging Face custom GGUF resolver`, () => {

    test( `hydrates generic model.gguf files from GGUF metadata`, async () => {
        const fetch_impl = vi.fn( async url => {
            if( url === `https://huggingface.co/api/models/tatjr13/tpn002-entry-a?blobs=true` ) {
                return json_response( {
                    gguf: {
                        total: 8_953_803_264,
                        architecture: `qwen35`,
                        context_length: 262_144,
                        totalFileSize: 4_859_552_672,
                    },
                    siblings: [
                        { rfilename: `.gitattributes`, size: 1566 },
                        {
                            rfilename: `model.gguf`,
                            size: 4_859_552_672,
                            lfs: { size: 4_859_552_672 },
                        },
                    ],
                    cardData: {
                        license: `apache-2.0`,
                    },
                } )
            }

            throw new Error( `Unexpected fetch: ${ url }` )
        } )

        const model = await resolve_hf_model(
            parse_hf_url( `https://huggingface.co/tatjr13/tpn002-entry-a` ),
            { fetch_impl },
        )

        expect( model ).toMatchObject( {
            id: `custom-tpn002-entry-a`,
            name: `tpn002 entry a`,
            family: `qwen35`,
            parameters: 8_953_803_264,
            parameters_label: `9B`,
            quantization: `GGUF`,
            bpw: 4.3,
            file_size_bytes: 4_859_552_672,
            context_length: 262_144,
            layers: 8,
            block_count: 32,
            kv_heads: 4,
            head_dim: 256,
            file_name: `model.gguf`,
            hugging_face_repo: `tatjr13/tpn002-entry-a`,
            reasoning: true,
            reasoning_enabled: false,
            license: `apache-2.0`,
        } )
        expect( can_fit_in_memory( model, 5_600_000_000 ) ).toBe( true )
    } )

} )
