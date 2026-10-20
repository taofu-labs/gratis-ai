import { useId } from 'react'
import styled from 'styled-components'
import { useTranslation } from 'react-i18next'

const Section = styled.div`
    margin-bottom: ${ ( { theme } ) => theme.spacing.lg };
`

const Label = styled.label`
    display: block;
    font-weight: 500;
    margin-bottom: ${ ( { theme } ) => theme.spacing.xs };
    font-size: 0.9rem;
`

const Description = styled.p`
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    margin-bottom: ${ ( { theme } ) => theme.spacing.sm };
    line-height: 1.4;
`

const SliderRow = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
`

const Slider = styled.input`
    flex: 1;
    accent-color: ${ ( { theme } ) => theme.colors.accent };
`

const NumberInput = styled.input`
    width: ${ ( { $width } ) => $width || `70px` };
    padding: ${ ( { theme } ) => theme.spacing.xs };
    background: ${ ( { theme } ) => theme.colors.input_background };
    color: ${ ( { theme } ) => theme.colors.text };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.sm };
    text-align: center;
    font-size: 0.85rem;

    @media ${ ( { theme } ) => theme.media.touch } {
        min-height: 2.75rem;
    }
`

const TextInput = styled.input`
    width: 100%;
    padding: ${ ( { theme } ) => theme.spacing.sm };
    background: ${ ( { theme } ) => theme.colors.input_background };
    color: ${ ( { theme } ) => theme.colors.text };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.sm };
    font-size: 0.85rem;
`

const Divider = styled.div`
    height: 1px;
    background: ${ ( { theme } ) => theme.colors.border_subtle };
    margin: ${ ( { theme } ) => `${ theme.spacing.lg } 0` };
`

const DividerLabel = styled.p`
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    margin-bottom: ${ ( { theme } ) => theme.spacing.md };
`

// Fine-tuning knobs — `slider: false` renders a number field only
const FINE_TUNING = [
    { key: `top_p`, min: 0, max: 1, step: 0.05, fallback: 0.95 },
    { key: `top_k`, min: 0, max: 200, fallback: 40, int: true, slider: false, width: `100px` },
    { key: `min_p`, min: 0, max: 1, step: 0.01, fallback: 0.05 },
    { key: `repeat_penalty`, min: 1, max: 2, step: 0.05, fallback: 1.1, empty: 1 },
    { key: `repeat_last_n`, min: 0, max: 2048, fallback: 64, int: true, slider: false, width: `100px` },
    { key: `frequency_penalty`, min: 0, max: 2, step: 0.1, fallback: 0 },
    { key: `presence_penalty`, min: 0, max: 2, step: 0.1, fallback: 0 },
    { key: `seed`, min: -1, fallback: -1, int: true, slider: false, width: `120px`, empty: -1 },
]

/**
 * One labelled setting: label + description, slider and/or number field.
 * The label names the slider and the number field; the description describes both.
 * @param {Object} props
 * @param {Object} props.field - Field config (key, min, max, step, int, slider, width, empty)
 * @param {number} props.value - Current value
 * @param {Function} props.on_change - Handler (key, value)
 * @param {string} [props.testid] - data-testid prefix for slider/input
 * @returns {JSX.Element}
 */
function NumberField( { field, value, on_change, testid } ) {

    const { t } = useTranslation( `settings` )
    const id = useId()
    const { key, min, max, step, int, slider = true, width, empty = 0 } = field

    const parse = ( raw ) => int ? parseInt( raw ) : parseFloat( raw )
    const range = { min, max, step }
    const a11y = {
        'aria-labelledby': `${ id }-label`,
        'aria-describedby': `${ id }-description`,
    }

    const number_input = <NumberInput
        id={ `${ id }-input` }
        data-testid={ testid && `${ testid }-input` }
        type="number"
        { ...range }
        { ...a11y }
        $width={ width }
        value={ value }
        onChange={ ( e ) => on_change( key, parse( e.target.value ) || empty ) }
    />

    return <Section>

        <Label id={ `${ id }-label` } htmlFor={ `${ id }-input` }>{ t( field.label || key ) }</Label>
        <Description id={ `${ id }-description` }>{ t( `${ field.label || key }_description` ) }</Description>

        { slider
            ? <SliderRow>
                <Slider
                    data-testid={ testid && `${ testid }-slider` }
                    type="range"
                    { ...range }
                    { ...a11y }
                    value={ value }
                    onChange={ ( e ) => on_change( key, parse( e.target.value ) ) }
                />
                { number_input }
            </SliderRow>
            : number_input }

    </Section>

}

/**
 * Advanced settings tab — includes Temperature and Max Tokens
 * (moved from Basic for progressive disclosure) plus all fine-tuning knobs.
 * Descriptions are written in plain language.
 * @param {Object} props
 * @param {Object} props.settings - Current settings values
 * @param {Function} props.on_change - Handler for setting changes (key, value)
 * @returns {JSX.Element}
 */
export default function AdvancedSettings( { settings, on_change } ) {

    const { t } = useTranslation( `settings` )
    const stop_id = useId()

    return <>

        { /* Temperature — moved from Basic */ }
        <NumberField
            testid="temperature"
            field={ { key: `temperature`, label: `creativity`, min: 0, max: 2, step: 0.1 } }
            value={ settings.temperature }
            on_change={ on_change }
        />

        { /* Max Tokens — moved from Basic */ }
        <NumberField
            testid="max-tokens"
            field={ { key: `max_tokens`, label: `response_length`, min: 64, max: 32768, step: 64, int: true, slider: false, width: `120px`, empty: 64 } }
            value={ settings.max_tokens }
            on_change={ on_change }
        />

        <Divider />
        <DividerLabel>{ t( `fine_tuning` ) }</DividerLabel>

        { FINE_TUNING.map( ( field ) =>
            <NumberField
                key={ field.key }
                field={ field }
                value={ settings[ field.key ] ?? field.fallback }
                on_change={ on_change }
            />
        ) }

        { /* Stop Sequences */ }
        <Section>
            <Label htmlFor={ `${ stop_id }-input` }>{ t( `stop_sequences` ) }</Label>
            <Description id={ `${ stop_id }-description` }>{ t( `stop_sequences_description` ) }</Description>
            <TextInput
                id={ `${ stop_id }-input` }
                aria-describedby={ `${ stop_id }-description` }
                type="text"
                placeholder={ t( `stop_sequences_placeholder` ) }
                value={ settings.stop_sequences ?? `` }
                onChange={ ( e ) => on_change( `stop_sequences`, e.target.value ) }
            />
        </Section>

    </>

}
