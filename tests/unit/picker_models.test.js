import { describe, expect, test } from 'vitest'
import { MODEL_CATALOG, select_for_preferences, select_picker_models } from '../../src/utils/model_catalog'

const GB = 1_000_000_000

// A desktop browser with Memory64 and the conservative automatic budget
const DEVICE = {
    runtime: `browser`,
    ceiling_bytes: 15 * GB,
    budget_bytes: 5.6 * GB,
    automatic_bytes: 5.6 * GB,
    receipt_bytes: 5.6 * GB,
    bandwidth_gbs: 5,
}

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

    test( `a comfortably fitting winner leads with default preferences`, () => {
        const picks = select_picker_models( { winners: [ winner() ], device: DEVICE } )
        expect( picks.from_winner ).toBe( true )
        expect( picks.pick.is_tpn_winner ).toBe( true )
        expect( picks.winners ).toHaveLength( 1 )
    } )

    test( `no winners falls back to the device recommender`, () => {
        const picks = select_picker_models( { winners: [], device: DEVICE } )
        expect( picks.from_winner ).toBe( false )
        expect( picks.pick ).toEqual( select_for_preferences( MODEL_CATALOG, DEVICE ).pick )
        expect( picks.pick.hidden ).toBeFalsy()
    } )

    test( `winners that do not fit stay listed while the catalog fills in`, () => {
        const huge = winner( { size: 40 * GB } )
        const picks = select_picker_models( { winners: [ huge ], device: DEVICE } )
        expect( picks.winners ).toEqual( [ huge ] )
        expect( picks.from_winner ).toBe( false )
        expect( picks.pick ).not.toBeNull()
    } )

    test( `adjusting preferences hands the recommendation to the catalog`, () => {
        const picks = select_picker_models( { winners: [ winner() ], device: DEVICE, preferences: { vision: true } } )
        expect( picks.from_winner ).toBe( false )
        expect( picks.pick.mmproj ).toBeTruthy()
    } )

    test( `a winner's fallback is only ever a smaller catalog model`, () => {
        const small = select_picker_models( { winners: [ winner( { size: 100_000_000 } ) ], device: DEVICE } )
        const large = select_picker_models( { winners: [ winner( { size: 4 * GB } ) ], device: DEVICE } )
        expect( small.fallback ).toBeNull()
        expect( large.fallback ).not.toBeNull()
    } )

    test( `a tiny budget yields no pick rather than a misfit`, () => {
        const picks = select_picker_models( { device: { ...DEVICE, budget_bytes: 1, automatic_bytes: 1 } } )
        expect( picks.pick ).toBeNull()
        expect( picks.relaxed ).toEqual( [] )
    } )

    test( `winners sort newest competition first, then smallest file`, () => {
        const picks = select_picker_models( {
            winners: [
                winner( { competition: `TPN-001`, size: 300_000_000 } ),
                winner( { competition: `TPN-002`, size: 900_000_000 } ),
                winner( { competition: `TPN-002`, size: 500_000_000 } ),
            ],
            device: DEVICE,
        } )
        expect( picks.winners.map( m => [ m.tpn_competition, m.file_size_bytes ] ) ).toEqual( [
            [ `TPN-002`, 500_000_000 ],
            [ `TPN-002`, 900_000_000 ],
            [ `TPN-001`, 300_000_000 ],
        ] )
        expect( picks.pick.tpn_competition ).toBe( `TPN-002` )
    } )

} )
