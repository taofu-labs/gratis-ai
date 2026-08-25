import { describe, expect, test, vi } from 'vitest'
import { resolve_tpn_winner_models } from '../../src/utils/tpn_winner_models'

const json_response = data => ( {
    ok: true,
    json: async () => data,
} )

describe( `TPN winner models`, () => {

    test( `derives selectable GGUF variants from collection winner notes`, async () => {

        const fetch_impl = vi.fn( async url => {

            if( url === `https://huggingface.co/api/collections?owner=tpnlabs&limit=50` ) {
                return json_response( [
                    {
                        title: `TPN-001`,
                        slug: `tpnlabs/tpn-001-6a8d672ecebe1a591d661dbe`,
                        items: [
                            {
                                type: `model`,
                                id: `tpnlabs/tpn-001-base`,
                                note: { text: `base` },
                            },
                            {
                                type: `model`,
                                id: `ninja990621/tpn-001-v7`,
                                author: `ninja990621`,
                                note: { text: `tpn-001-winner` },
                            },
                        ],
                    },
                ] )
            }

            if( url === `https://huggingface.co/api/models/ninja990621/tpn-001-v7?blobs=false` ) {
                return json_response( {
                    numParameters: 1_881_825_088,
                    gguf: {
                        architecture: `qwen35`,
                        context_length: 262_144,
                    },
                    siblings: [
                        { rfilename: `README.md` },
                        { rfilename: `v7-Q8_0.gguf`, size: 2_012_011_904 },
                    ],
                    cardData: {
                        license: `apache-2.0`,
                    },
                } )
            }

            throw new Error( `Unexpected fetch: ${ url }` )

        } )

        const models = await resolve_tpn_winner_models( { fetch_impl } )

        expect( models ).toHaveLength( 1 )
        expect( models[ 0 ] ).toMatchObject( {
            id: `tpn-001-winner-v7-q8-0`,
            name: `TPN-001 Winner`,
            family: `qwen35`,
            parameters_label: `1.9B`,
            quantization: `Q8_0`,
            file_size_bytes: 2_012_011_904,
            context_length: 262_144,
            layers: 6,
            block_count: 24,
            kv_heads: 2,
            head_dim: 256,
            hugging_face_repo: `ninja990621/tpn-001-v7`,
            file_name: `v7-Q8_0.gguf`,
            tpn_competition: `TPN-001`,
            tpn_author: `ninja990621`,
        } )

    } )

} )
