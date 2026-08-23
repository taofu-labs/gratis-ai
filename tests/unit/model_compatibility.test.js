import { describe, expect, it } from 'vitest'
import {
    get_browser_model_incompatibility,
    get_browser_model_warning,
} from '../../src/utils/model_compatibility'

describe( `browser model compatibility`, () => {

    it( `does not hard-block single GGUF files above 2 GiB with Memory64 runtime`, () => {

        const model = { file_size_bytes: 2.5 * 1024 * 1024 * 1024 }

        expect( get_browser_model_incompatibility( model ) ).toBeNull()
        expect( get_browser_model_warning( model ) ).toContain( `Memory64` )

    } )

} )
