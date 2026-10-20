import { describe, expect, test } from 'vitest'
import { BROWSER_AUTOMATIC_MODEL_CEILING_BYTES } from '../../src/utils/device_detection'
import { estimate_model_memory, select_model_options, select_picker_models } from '../../src/utils/model_catalog'

const GB = 1_000_000_000

// Minimal TPN winner variant shaped like resolve_tpn_winner_models output
const winner = ( { competition = `TPN-001`, size = 400_000_000, id = `${ competition }-${ size }` } = {} ) => ( {
    id,
    name: `${ competition } Winner`,
    parameters: size * 2,
    bpw: 4.8,
    file_size_bytes: size,
    context_length: 4096,
    is_tpn_winner: true,
    tpn_competition: competition,
} )

describe( `select_picker_models`, () => {

    test( `fitting winners lead and suppress the catalog`, () => {
        const picks = select_picker_models( { winners: [ winner() ], max_bytes: 8 * GB } )
        expect( picks.use_catalog ).toBe( false )
        expect( picks.winners ).toHaveLength( 1 )
        expect( picks.recommendations.smarter ).toBeNull()
        expect( picks.alternatives ).toEqual( [] )
    } )

    test( `no winners falls back to the device recommender`, () => {
        const picks = select_picker_models( { winners: [], max_bytes: 8 * GB } )
        expect( picks.use_catalog ).toBe( true )
        expect( picks.recommendations ).toEqual( select_model_options( 8 * GB ) )
        expect( picks.recommendations.smarter ).not.toBeNull()
    } )

    test( `winners that do not fit stay listed while the catalog fills in`, () => {
        const huge = winner( { size: 40 * GB } )
        const picks = select_picker_models( { winners: [ huge ], max_bytes: 4 * GB } )
        expect( picks.winners ).toEqual( [ huge ] )
        expect( picks.use_catalog ).toBe( true )
        expect( picks.recommendations.smarter ).not.toBeNull()
    } )

    test( `automatic cards use the conservative budget, alternatives the manual one`, () => {
        const picks = select_picker_models( { max_bytes: 12 * GB, automatic_bytes: 2 * GB } )
        const card_ids = Object.values( picks.recommendations ).filter( Boolean ).map( m => m.id )

        Object.values( picks.recommendations ).filter( Boolean ).forEach( m =>
            expect( estimate_model_memory( m ) ).toBeLessThanOrEqual( 2 * GB ) )
        expect( picks.alternatives.some( m => estimate_model_memory( m ) > 2 * GB ) ).toBe( true )
        expect( picks.alternatives.some( m => card_ids.includes( m.id ) ) ).toBe( false )
    } )

    test( `alternatives past the receipt ceiling need a browser receipt`, () => {
        const picks = select_picker_models( {
            max_bytes: 15 * GB,
            receipt_ceiling_bytes: BROWSER_AUTOMATIC_MODEL_CEILING_BYTES,
        } )
        const oversized = picks.alternatives.filter( m => estimate_model_memory( m ) > BROWSER_AUTOMATIC_MODEL_CEILING_BYTES )
        expect( oversized.every( m => m.browser_verified === true ) ).toBe( true )
    } )

    test( `a tiny budget yields no cards rather than a misfit`, () => {
        const picks = select_picker_models( { max_bytes: 1 } )
        expect( picks.use_catalog ).toBe( true )
        expect( Object.values( picks.recommendations ).every( m => m === null ) ).toBe( true )
        expect( picks.alternatives ).toEqual( [] )
    } )

    test( `winners sort newest competition first, then smallest file`, () => {
        const picks = select_picker_models( {
            winners: [
                winner( { competition: `TPN-001`, size: 300_000_000 } ),
                winner( { competition: `TPN-002`, size: 900_000_000 } ),
                winner( { competition: `TPN-002`, size: 500_000_000 } ),
            ],
            max_bytes: 8 * GB,
        } )
        expect( picks.winners.map( m => [ m.tpn_competition, m.file_size_bytes ] ) ).toEqual( [
            [ `TPN-002`, 500_000_000 ],
            [ `TPN-002`, 900_000_000 ],
            [ `TPN-001`, 300_000_000 ],
        ] )
    } )

} )
