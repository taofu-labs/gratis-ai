import { useState } from 'react'
import styled from 'styled-components'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import {
    format_file_size,
    has_fewer_refusals,
    has_image_input,
    model_download_bytes,
    quality_score,
} from '../../utils/model_catalog'

const Wrapper = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${ ( { theme } ) => theme.spacing.md };
    width: 100%;
`

const Toolbar = styled.div`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: ${ ( { theme } ) => theme.spacing.sm };
`

const Chips = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: ${ ( { theme } ) => theme.spacing.xs };
`

const Chip = styled.button`
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 2rem;
    padding: 0 0.75rem;
    border: 1px solid ${ ( { theme, $on } ) => $on ? theme.colors.accent : theme.colors.border_control };
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    font-size: 0.8rem;
    color: ${ ( { theme, $on } ) => $on ? theme.colors.text : theme.colors.text_secondary };
    background: ${ ( { theme, $on } ) => $on ? `${ theme.colors.accent }1f` : `transparent` };
    transition: border-color 0.16s, background-color 0.16s;

    &:hover { border-color: ${ ( { theme } ) => theme.colors.border_strong }; }
`

const SortLabel = styled.label`
    display: inline-flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };

    select {
        min-height: 2rem;
        padding: 0 ${ ( { theme } ) => theme.spacing.xs };
        border: 1px solid ${ ( { theme } ) => theme.colors.border_control };
        border-radius: ${ ( { theme } ) => theme.border_radius.md };
        background: ${ ( { theme } ) => theme.colors.input_background };
        color: ${ ( { theme } ) => theme.colors.text };
        font-size: 0.8rem;
    }
`

const GroupTitle = styled.h3`
    font-size: 0.85rem;
    font-weight: 600;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
`

const List = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${ ( { theme } ) => theme.spacing.xs };
`

const Row = styled.button`
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    width: 100%;
    padding: ${ ( { theme } ) => theme.spacing.sm } ${ ( { theme } ) => theme.spacing.md };
    border: 1px solid ${ ( { theme, $active } ) => $active ? theme.colors.accent : theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    text-align: left;
    background: ${ ( { theme, $active } ) => $active ? `${ theme.colors.accent }10` : `transparent` };
    transition: border-color 0.15s, background-color 0.15s;

    &:hover:not( :disabled ) { background: ${ ( { theme, $active } ) => $active ? `${ theme.colors.accent }14` : theme.colors.surface_hover }; }

    /* Won't fit: readable but clearly unavailable, with the reason inline */
    &:disabled {
        cursor: not-allowed;
        opacity: 0.6;
    }
`

const RowMain = styled.div`
    flex: 1;
    min-width: 0;
`

const RowName = styled.div`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    font-size: 0.9rem;
    font-weight: 500;
    color: ${ ( { theme } ) => theme.colors.text };
`

const Tag = styled.span`
    padding: 0 0.375rem;
    border: 1px solid ${ ( { theme } ) => theme.colors.border_strong };
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    font-size: 0.7rem;
    font-weight: 400;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    white-space: nowrap;
`

const RowMeta = styled.div`
    margin-top: 2px;
    font-size: 0.8rem;
    line-height: 1.45;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    overflow-wrap: anywhere;
`

const RowReason = styled( RowMeta )`
    color: ${ ( { theme } ) => theme.colors.warning };
`

const Quiet = styled.button`
    align-self: flex-start;
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    min-height: 2.75rem;
    font-size: 0.85rem;
    color: ${ ( { theme } ) => theme.colors.text_secondary };

    &:hover { color: ${ ( { theme } ) => theme.colors.text }; }
`

const Empty = styled.p`
    font-size: 0.85rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

const LONG_CONTEXT_TOKENS = 131_072

const FILTERS = [
    { key: `photos`, label: `filter_photos`, test: has_image_input },
    { key: `fewer_refusals`, label: `filter_fewer_refusals`, test: has_fewer_refusals },
    { key: `reasoning`, label: `filter_reasoning`, test: m => !!m.reasoning },
    { key: `multilingual`, label: `filter_multilingual`, test: m => !!m.multilingual },
    { key: `long_docs`, label: `filter_long_docs`, test: m => m.context_length >= LONG_CONTEXT_TOKENS },
]

const SORTS = {
    recommended: ( a, b ) => b.score - a.score,
    fastest: ( a, b ) => b.speed - a.speed,
    smartest: ( a, b ) => quality_score( b.model ) - quality_score( a.model ),
    smallest: ( a, b ) => model_download_bytes( a.model ) - model_download_bytes( b.model ),
}

const SPEED_KEYS = { quick: `speed_quick`, steady: `speed_steady`, slow: `speed_slow` }

/**
 * Expert view of the whole catalog: capability filters, sorting, and honest
 * fit verdicts. Rows that cannot run stay visible, greyed, with the reason.
 *
 * @param {Object} props
 * @param {Array} props.rows - describe_models() output for visible models
 * @param {Array} props.retired_rows - describe_models() output for hidden models
 * @param {Array} props.winner_rows - describe_models() output for TPN winners
 * @param {string|null} props.selected_id
 * @param {Function} props.on_select
 * @param {Function} props.is_cached
 * @param {Function} props.fit_reason - ( fit ) => string|null
 */
export default function ModelBrowser( { rows, retired_rows, winner_rows, recommended_id, selected_id, on_select, is_cached, fit_reason, children } ) {

    const { t } = useTranslation( `models` )
    const [ filters, set_filters ] = useState( [] )
    const [ sort, set_sort ] = useState( `recommended` )
    const [ show_retired, set_show_retired ] = useState( false )
    const [ show_unfit, set_show_unfit ] = useState( false )

    const toggle_filter = key => set_filters( current => current.includes( key )
        ? current.filter( k => k !== key )
        : [ ...current, key ] )

    // The recommendation leads its own sort; then comfortable before tight
    const is_pinned = row => sort === `recommended` && row.model.id === recommended_id
    const order = list => [ ...list ].sort( ( a, b ) =>
        Number( is_pinned( b ) ) - Number( is_pinned( a ) )
        || Number( b.fit.comfortable ) - Number( a.fit.comfortable )
        || SORTS[ sort ]( a, b ) )

    const active_tests = FILTERS.filter( f => filters.includes( f.key ) ).map( f => f.test )
    const matching_rows = rows.filter( ( { model } ) => active_tests.every( test => test( model ) ) )

    // Models that can't run here stay one tap away, greyed with their reason
    const visible_rows = order( matching_rows.filter( row => row.fit.fits ) )
    const unfit_rows = order( matching_rows.filter( row => !row.fit.fits ) )

    const render_row = ( { model, fit, band }, label = model.name ) => {

        const is_selected = model.id === selected_id
        const reason = fit_reason( fit )
        const meta = [
            model.quantization,
            t( `download_size`, { size: format_file_size( model_download_bytes( model ) ) } ),
            t( `row_memory`, { size: format_file_size( fit.memory ) } ),
            t( SPEED_KEYS[ band ] ),
        ].filter( Boolean ).join( ` · ` )

        return <Row
            key={ model.id }
            type="button"
            data-testid={ `model-option-${ model.id }` }
            $active={ is_selected }
            aria-pressed={ is_selected }
            disabled={ !fit.fits }
            onClick={ () => on_select( model.id ) }
        >
            <RowMain>
                <RowName>
                    { label }
                    { has_image_input( model ) && <Tag>{ t( `filter_photos` ) }</Tag> }
                    { has_fewer_refusals( model ) && <Tag>{ t( `filter_fewer_refusals` ) }</Tag> }
                    { model.specialist === `coding` && <Tag>{ t( `tag_coding` ) }</Tag> }
                    { model.license_flag && <Tag title={ t( `license_flag_title` ) }>{ model.license_flag }</Tag> }
                    { is_cached( model.id ) && <Tag>{ t( `downloaded` ) }</Tag> }
                </RowName>
                <RowMeta>{ meta }</RowMeta>
                { reason && <RowReason>{ reason }</RowReason> }
            </RowMain>
            { is_selected && <Check size={ 16 } /> }
        </Row>

    }

    return <Wrapper data-testid="model-browser">

        { winner_rows.length > 0 && <>
            <GroupTitle>{ t( `tpn_winner_models_section` ) }</GroupTitle>
            <List data-testid="tpn-model-list">
                { winner_rows.map( row => render_row( row, t( `tpn_winner_label`, { competition: row.model.tpn_competition || `TPN` } ) ) ) }
            </List>
        </> }

        <Toolbar>
            <Chips role="group" aria-label={ t( `filter_label` ) }>
                { FILTERS.map( ( { key, label } ) => <Chip
                    key={ key }
                    type="button"
                    $on={ filters.includes( key ) }
                    aria-pressed={ filters.includes( key ) }
                    data-testid={ `filter-${ key }` }
                    onClick={ () => toggle_filter( key ) }
                >
                    { filters.includes( key ) && <Check size={ 12 } /> }
                    { t( label ) }
                </Chip> ) }
            </Chips>

            <SortLabel>
                { t( `sort_label` ) }
                <select value={ sort } onChange={ e => set_sort( e.target.value ) } data-testid="model-sort">
                    { Object.keys( SORTS ).map( key => <option key={ key } value={ key }>{ t( `sort_${ key }` ) }</option> ) }
                </select>
            </SortLabel>
        </Toolbar>

        <List data-testid="catalog-model-list">
            { visible_rows.map( row => render_row( row ) ) }
            { !matching_rows.length && <Empty>{ t( `no_models_match` ) }</Empty> }
        </List>

        { unfit_rows.length > 0 && <>
            <Quiet
                type="button"
                aria-expanded={ show_unfit }
                data-testid="show-unfit-toggle"
                onClick={ () => set_show_unfit( !show_unfit ) }
            >
                { show_unfit ? t( `hide_unfit` ) : t( `show_unfit`, { count: unfit_rows.length } ) }
                { show_unfit ? <ChevronUp size={ 14 } /> : <ChevronDown size={ 14 } /> }
            </Quiet>
            { show_unfit && <List data-testid="unfit-model-list">
                { unfit_rows.map( row => render_row( row ) ) }
            </List> }
        </> }

        { retired_rows.length > 0 && <>
            <Quiet
                type="button"
                aria-expanded={ show_retired }
                data-testid="show-retired-toggle"
                onClick={ () => set_show_retired( !show_retired ) }
            >
                { show_retired ? t( `hide_retired` ) : t( `show_retired`, { count: retired_rows.length } ) }
                { show_retired ? <ChevronUp size={ 14 } /> : <ChevronDown size={ 14 } /> }
            </Quiet>
            { show_retired && <List data-testid="retired-model-list">
                { order( retired_rows ).map( row => render_row( row ) ) }
            </List> }
        </> }

        { children }

    </Wrapper>

}
